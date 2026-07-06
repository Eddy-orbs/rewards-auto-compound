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
    web3Singleton = await getWeb3Polygon(endpoint);
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
