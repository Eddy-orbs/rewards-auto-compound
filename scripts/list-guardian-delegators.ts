import dotenv from 'dotenv';
import {getDelegators} from '@orbs-network/pos-analytics-lib';
import {getWeb3, setSingleWeb3} from '../src/web3Singleton';

dotenv.config();

function usage() {
    console.error('Usage: npx ts-node scripts/list-guardian-delegators.ts <guardian-address>');
}

async function main() {
    const guardianAddress = process.argv[2];

    if (!guardianAddress) {
        usage();
        process.exit(1);
    }

    await setSingleWeb3();
    const web3 = getWeb3();

    if (!web3.utils.isAddress(guardianAddress)) {
        console.error(`Invalid guardian address: ${guardianAddress}`);
        process.exit(1);
    }

    const delegators = await getDelegators(guardianAddress, web3);

    console.log('address\tstake\tnon_stake\tlast_change_block\tlast_change_time');
    for (const delegator of delegators) {
        console.log([
            delegator.address,
            delegator.stake,
            delegator.non_stake,
            delegator.last_change_block,
            delegator.last_change_time,
        ].join('\t'));
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
