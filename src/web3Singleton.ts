import { getWeb3Polygon } from "@orbs-network/pos-analytics-lib";
import dotenv from 'dotenv';
import * as process from "process";

dotenv.config();
const polygonEndpoint = process.env.PROVIDER_ENDPOINT;
const polygonEndpointAlt = process.env.PROVIDER_ENDPOINT_ALT;

let web3Singleton;
let activeEndpointName = 'primary';

async function createWeb3(endpoint: string, endpointName: string) {
    if (!endpoint) throw new Error(`${endpointName} RPC endpoint is not configured`);
    // This service only uses direct contract calls and does not need the PoS
    // library's historical contract discovery. Enabling it scans the Polygon
    // registry from its deployment block in one eth_getLogs request, which is
    // rejected by RPC providers that enforce a 10,000-block range limit.
    web3Singleton = await getWeb3Polygon(endpoint, false);
    web3Singleton.eth.transactionPollingTimeout = 750;
    web3Singleton.eth.transactionBlockTimeout = 50;
    web3Singleton.eth.transactionConfirmationBlocks = 24;
    activeEndpointName = endpointName;
}

export async function setSingleWeb3() {
    await createWeb3(polygonEndpoint, 'primary');
}

export async function switchToAlternateWeb3() {
    await createWeb3(polygonEndpointAlt, 'alternate');
}

export function hasAlternateWeb3() {
    return Boolean(polygonEndpointAlt);
}

export function getActiveEndpointName() {
    return activeEndpointName;
}

export function getWeb3() {
    return web3Singleton;
}
