import {getDelegators, getGuardians} from "@orbs-network/pos-analytics-lib";
import {getActiveEndpointName, getWeb3, hasAlternateWeb3, setSingleWeb3, switchToAlternateWeb3} from './web3Singleton'
import {stakingRewardsAbi} from './abi'
import {constants} from "./constants";
import * as process from "process";
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import {bigToNumber} from "@orbs-network/pos-analytics-lib/dist/helpers";
import BigNumber from 'bignumber.js';
const EthereumMulticall = require('@orbs-network/ethereum-multicall');
const MULTICALL3_POLYGON_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const RETRY_DELAY_MS = 5000;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatRpcError(error) {
    if (!error) return 'Unknown error';
    return error.message || String(error);
}

async function withRpcFallback<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (firstError) {
        console.warn(`${operationName} failed on ${getActiveEndpointName()} RPC: ${formatRpcError(firstError)}`);
        console.warn(`Retrying ${operationName} in ${RETRY_DELAY_MS / 1000} seconds...`);
        await sleep(RETRY_DELAY_MS);
    }

    try {
        return await operation();
    } catch (secondError) {
        console.warn(`${operationName} retry failed on ${getActiveEndpointName()} RPC: ${formatRpcError(secondError)}`);

        if (!hasAlternateWeb3() || getActiveEndpointName() === 'alternate') {
            throw secondError;
        }

        console.warn(`Switching to alternate RPC endpoint for ${operationName}...`);
        await switchToAlternateWeb3();
    }

    try {
        return await operation();
    } catch (alternateError) {
        console.error(`${operationName} failed on alternate RPC: ${formatRpcError(alternateError)}`);
        throw alternateError;
    }
}

function addWalletAccount(web3) {
    const account = web3.eth.accounts.privateKeyToAccount(process.env.PK);
    if (!web3.eth.accounts.wallet[account.address]) {
        web3.eth.accounts.wallet.add(account);
    }
    return account;
}

function buildEncodedCalls(web3, calls) {
    const stakingRewardContract = new web3.eth.Contract(stakingRewardsAbi, constants.stakingRewardContractAddress);
    return calls.map((call) => ({
        target: constants.stakingRewardContractAddress,
        callData: stakingRewardContract.methods.claimStakingRewards(call.methodParameters[0]).encodeABI()
    }));
}

async function CalcAndSendMetrics(numberOfWallets, totalCompounded) {
    // get staking balance
    const minABI = [{"constant":true, "inputs":[{"name":"_owner","type":"address"}], "name":"balanceOf", "outputs":[{"name":"balance","type":"uint256"}], "type":"function"}, {"constant":true, "inputs":[], "name":"decimals", "outputs":[{"name":"","type":"uint8"}], "type":"function"}];
    let stakingBalance = await withRpcFallback('read staking balance', async () => {
        const web3 = getWeb3();
        const tokenContract = new web3.eth.Contract(minABI, constants.orbsErc20)
        return await tokenContract.methods.balanceOf(constants.stakingContract).call();
    });
    stakingBalance = bigToNumber(new BigNumber(stakingBalance));

    const json = {"numberOfWallets": numberOfWallets, "totalCompounded": totalCompounded, "stakingBalance": stakingBalance}
    const response = await fetch(constants.esEndpoint, {
        method: 'post',
        body: JSON.stringify(json),
        headers: {'Content-Type': 'application/json'}
    });
    console.log(response)
}

async function getDelegatorsList() {
    console.log("Getting a list of stakers...")
    let stakers: string[] = [];
    const allGuardians = await getGuardians(constants.nodeEndpoints)
    for (const guardian of allGuardians) {
        console.log(`Working on guardian ${guardian.address}`)
        const g_info = await withRpcFallback(`get delegators for ${guardian.address}`, async () => {
            return await getDelegators(guardian.address, getWeb3());
        });
        stakers.push(guardian.address);
        for (const d of g_info) {
            if (d.stake > constants.compoundRewardsThreshold) stakers.push(d.address);
        }
    }
    console.log(`Found ${stakers.length} stakers`)
    return stakers;
}

function isSimulationMode() {
    return process.argv.includes('--simulate') || process.env.SIMULATE === 'true';
}

function getSimulationResults(simulationResponse) {
    return simulationResponse.returnData || simulationResponse[2] || [];
}

async function claimBatch(stakersList: string[], simulate: boolean) {
    console.log(simulate ? 'Simulating...' : 'Claiming...');
    let numberOfWallets = 0;
    let totalCompounded = 0;
    const stakersListLen = stakersList.length;
    let calls;

    const chunksNum = Math.ceil((constants.baseGas+constants.additionalWallet*stakersListLen) / (constants.blockGasLimit*constants.blockUtilization));
    let chunkSize = Math.max(1, Math.floor(stakersListLen/chunksNum))
    chunkSize = Math.max(1, Math.floor(chunkSize / 2))
    console.log(`Running in ${chunksNum} chunks of ${chunkSize}`);
    for (let i = 0; i < stakersList.length; i += chunkSize) {
        calls = [];
        const chunk = stakersList.slice(i, i + chunkSize);
        while (chunk.length) {
            const staker = chunk.shift();
            console.log(staker);
            const rewardBalance = await withRpcFallback(`read staking rewards for ${staker}`, async () => {
                const web3 = getWeb3();
                const stakingRewardContract = new web3.eth.Contract(stakingRewardsAbi, constants.stakingRewardContractAddress);
                return await stakingRewardContract.methods.getDelegatorStakingRewardsData(staker).call();
            });
            let balance = bigToNumber(new BigNumber(rewardBalance.balance));
            numberOfWallets += 1;
            totalCompounded += balance;

            calls.push({
                reference: `claim-${staker}`,
                methodName: 'claimStakingRewards',
                methodParameters: [staker]
            })
        }
        const contractCallContext = [{
            reference: 'autoCompound',
            contractAddress: constants.stakingRewardContractAddress,
            abi: stakingRewardsAbi,
            calls
        }];
        if (simulate) {
            const {simulation, encodedCalls} = await withRpcFallback(`simulate chunk starting at index ${i}`, async () => {
                const web3 = getWeb3();
                const account = addWalletAccount(web3);
                const multicallContract = new web3.eth.Contract(EthereumMulticall.Multicall.ABI, MULTICALL3_POLYGON_ADDRESS);
                const encodedCalls = buildEncodedCalls(web3, calls);
                const simulation = await multicallContract.methods
                    .tryBlockAndAggregate(false, encodedCalls)
                    .call({from: account.address});
                return {simulation, encodedCalls};
            });
            const simulationResults = getSimulationResults(simulation);
            const failedCalls = calls
                .map((call, index) => ({call, result: simulationResults[index]}))
                .filter((entry) => !entry.result || !entry.result.success)
                .map((entry) => entry.call.methodParameters[0]);

            console.log(`Chunk ${Math.floor(i / chunkSize) + 1}: eth_call ok=${calls.length - failedCalls.length}/${calls.length}`);
            if (failedCalls.length > 0) {
                console.log(`Failed stakers: ${failedCalls.join(', ')}`);
            }

            try {
                const estimatedGas = await withRpcFallback(`estimate gas for chunk starting at index ${i}`, async () => {
                    const web3 = getWeb3();
                    const account = addWalletAccount(web3);
                    const multicallContract = new web3.eth.Contract(EthereumMulticall.Multicall.ABI, MULTICALL3_POLYGON_ADDRESS);
                    return await multicallContract.methods
                        .aggregate(encodedCalls)
                        .estimateGas({from: account.address});
                });
                console.log(`Chunk ${Math.floor(i / chunkSize) + 1}: estimated gas ${estimatedGas}`);
            } catch (e) {
                console.log(`Chunk ${Math.floor(i / chunkSize) + 1}: estimateGas failed: ${e.message}`);
            }
            continue;
        }

        console.log('multicall')
        await withRpcFallback(`claim chunk starting at index ${i}`, async () => {
            const web3 = getWeb3();
            const account = addWalletAccount(web3);
            const multicall = new EthereumMulticall.Multicall({web3Instance: web3});
            return await multicall.send(contractCallContext, {
                from: account.address,
                gas: constants.blockGasLimit * constants.blockUtilization,
                maxPriorityFeePerGas: constants.maxPriorityFeePerGas,
                maxFeePerGas: constants.maxFeePerGas
            })
        })
    }
    console.log(`${simulate ? 'Simulated' : 'Successfully claimed for'} ${numberOfWallets}/${stakersListLen} accounts`)
    return {numberOfWallets, totalCompounded};
}

async function main() {
    dotenv.config();
    await setSingleWeb3()
    const simulate = isSimulationMode();
    if (simulate) console.log("Simulation mode enabled")
    const stakers = await getDelegatorsList();
    const {numberOfWallets, totalCompounded} = await claimBatch(stakers, simulate)
    if (simulate) {
        console.log(`Simulation mode enabled, skipped metrics post. Wallets=${numberOfWallets}, totalCompounded=${totalCompounded}`);
        return;
    }
    await CalcAndSendMetrics(numberOfWallets, totalCompounded)
}
main().then(() => console.log("Done!")).catch(error => {
    console.error(error);
    process.exit(1);
})
