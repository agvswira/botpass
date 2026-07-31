"use strict";

const BOTCHAIN_TESTNET = Object.freeze({
  networkName: "BOT Chain Testnet",
  chainId: 968,
  chainIdHex: "0x3C8",
  defaultRpcUrl: "https://rpc.bohr.life",
  nativeCurrency: Object.freeze({
    name: "BOT",
    symbol: "BOT",
    decimals: 18,
  }),
  explorerUrl: "https://scan.bohr.life",
  faucetUrl: "https://faucet.botchain.ai/basic",
  intendedDeployer: "0xe604829a9c327b0d924718CfAcEF69BBdC8C0Efc",
});

const BOTCHAIN_MAINNET = Object.freeze({
  networkName: "BOT Chain Mainnet",
  chainId: 677,
  chainIdHex: "0x2A5",
  defaultRpcUrl: "https://rpc.botchain.ai",
  nativeCurrency: Object.freeze({
    name: "BOT",
    symbol: "BOT",
    decimals: 18,
  }),
  explorerUrl: "https://scan.botchain.ai",
  intendedDeployer: "0x1396483BFA097Da425658eDef1fdD373D66Be224",
});

function validateHttpUrl(value, variableName) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid HTTP or HTTPS URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${variableName} must use HTTP or HTTPS`);
  }

  return value;
}

function getTestnetRpcUrl() {
  const configured = process.env.BOTCHAIN_TESTNET_RPC_URL?.trim();
  return validateHttpUrl(
    configured || BOTCHAIN_TESTNET.defaultRpcUrl,
    "BOTCHAIN_TESTNET_RPC_URL"
  );
}

function sanitizeRpcOrigin(rpcUrl) {
  const parsed = new URL(rpcUrl);
  return parsed.origin;
}

module.exports = {
  BOTCHAIN_MAINNET,
  BOTCHAIN_TESTNET,
  getTestnetRpcUrl,
  sanitizeRpcOrigin,
};
