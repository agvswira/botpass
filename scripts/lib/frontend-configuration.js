"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ZeroAddress, getAddress, isAddress } = require("ethers");
const { validateDeploymentRecord } = require("./deployment");

const TESTNET_CHAIN_ID = 968;
const MAINNET_CHAIN_ID = 677;
const CONFIG_KEYS = Object.freeze([
  "environment",
  "status",
  "networkName",
  "chainId",
  "chainIdHex",
  "rpcUrl",
  "explorerUrl",
  "faucetUrl",
  "nativeCurrency",
  "contractName",
  "contractAddress",
  "deploymentTransactionHash",
  "activationReviewed",
  "sourceVerified",
  "writesEnabled",
]);

const EXPECTED_NETWORKS = Object.freeze({
  production: Object.freeze({
    chainId: MAINNET_CHAIN_ID,
    networkName: "BOT Chain Mainnet",
    rpcOrigin: "https://rpc.botchain.ai",
    explorerUrl: "https://scan.botchain.ai",
  }),
  staging: Object.freeze({
    chainId: TESTNET_CHAIN_ID,
    networkName: "BOT Chain Testnet",
    rpcOrigin: "https://rpc.bohr.life",
    explorerUrl: "https://scan.bohr.life",
  }),
});

function validateReviewedDeployment(deployment, activation, environment) {
  const network = EXPECTED_NETWORKS[environment];
  if (!network) {
    throw new Error(`Unknown BOTPass frontend environment: ${environment}`);
  }
  try {
    validateDeploymentRecord(deployment);
  } catch (error) {
    throw new Error(
      `Reviewed deployment is not a canonical strict record: ${error.message}`
    );
  }
  if (
    deployment.chainId !== network.chainId ||
    deployment.networkName !== network.networkName ||
    deployment.rpcOrigin !== network.rpcOrigin ||
    deployment.explorerUrl !== network.explorerUrl ||
    deployment.contractName !== "BOTPass"
  ) {
    throw new Error(
      `Reviewed deployment does not match the ${environment} network`
    );
  }
  if (
    activation?.enabled !== true ||
    activation.reviewed !== true ||
    activation.chainId !== deployment.chainId ||
    activation.contractAddress !== deployment.contractAddress ||
    activation.deploymentTransactionHash !==
      deployment.deploymentTransactionHash
  ) {
    throw new Error(
      `Reviewed BOTPass activation does not match the ${environment} deployment`
    );
  }
  if (
    !isAddress(deployment.contractAddress) ||
    getAddress(deployment.contractAddress) === ZeroAddress ||
    getAddress(deployment.contractAddress) !== deployment.contractAddress
  ) {
    throw new Error("BOTPass contract address is not a canonical checksum address");
  }
  return deployment;
}

function parseGeneratedConfig(source) {
  const match = source.match(
    /export const FRONTEND_CONFIG = Object\.freeze\((\{[\s\S]*\})\);\s*$/
  );
  if (!match) {
    throw new Error("Generated BOTPass frontend configuration cannot be parsed");
  }
  return JSON.parse(match[1]);
}

function validateGeneratedFrontend(projectRoot) {
  const source = fs.readFileSync(
    path.join(projectRoot, "frontend/src/contract-config.js"),
    "utf8"
  );
  const config = parseGeneratedConfig(source);
  const expected = EXPECTED_NETWORKS[config.environment];
  const keys = Object.keys(config).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...CONFIG_KEYS].sort())) {
    throw new Error("Generated BOTPass configuration has unexpected fields");
  }
  if (
    !expected ||
    config.chainId !== expected.chainId ||
    config.networkName !== expected.networkName ||
    config.rpcUrl !== expected.rpcOrigin ||
    config.explorerUrl !== expected.explorerUrl ||
    config.contractName !== "BOTPass"
  ) {
    throw new Error("Generated BOTPass network selection is not canonical");
  }
  if (config.environment === "production" && config.chainId !== MAINNET_CHAIN_ID) {
    throw new Error("Production BOTPass frontend must remain Mainnet-only");
  }
  if (config.status === "pending") {
    if (
      config.contractAddress !== null ||
      config.deploymentTransactionHash !== null ||
      config.activationReviewed !== false ||
      config.sourceVerified !== false ||
      config.writesEnabled !== false
    ) {
      throw new Error("Pending BOTPass configuration must not imply deployment");
    }
  } else if (
    config.status !== "active" ||
    !config.contractAddress ||
    !config.deploymentTransactionHash ||
    config.activationReviewed !== true
  ) {
    throw new Error("BOTPass deployment state must be active or truthfully pending");
  }
  if (
    config.status === "active" &&
    config.writesEnabled !== (config.environment === "staging")
  ) {
    throw new Error("BOTPass writes must be enabled only for active Testnet staging");
  }
  return {
    environment: config.environment,
    chainId: config.chainId,
    deploymentStatus: config.status,
  };
}

module.exports = {
  CONFIG_KEYS,
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  validateGeneratedFrontend,
  validateReviewedDeployment,
};
