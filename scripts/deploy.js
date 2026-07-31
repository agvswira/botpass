"use strict";

const path = require("node:path");
const readline = require("node:readline/promises");
const { JsonRpcProvider, Wallet } = require("ethers");
const { BOTCHAIN_MAINNET, BOTCHAIN_TESTNET } = require("../config/botchain");
const { loadProjectEnvironment } = require("./lib/environment");
const {
  deploymentPath,
  getNetwork,
  runDeploymentCommand,
} = require("./lib/deployment");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function selectNetwork(value) {
  if (value === "testnet") {
    return getNetwork(BOTCHAIN_TESTNET);
  }
  if (value === "mainnet") {
    return getNetwork(BOTCHAIN_MAINNET);
  }
  throw new Error("Select exactly testnet or mainnet");
}

function privateKeyVariable(chainId) {
  return chainId === BOTCHAIN_TESTNET.chainId
    ? "BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY"
    : "BOTPASS_MAINNET_DEPLOYER_PRIVATE_KEY";
}

function privateKeyCandidates(chainId) {
  return chainId === BOTCHAIN_TESTNET.chainId
    ? ["BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY", "BOTCHAIN_TESTNET_DEPLOYER_PRIVATE_KEY"]
    : ["BOTPASS_MAINNET_DEPLOYER_PRIVATE_KEY"];
}

function createSigner(provider, network) {
  const variableNames = privateKeyCandidates(network.chainId);
  const configured = variableNames.map((name) => process.env[name]?.trim()).find(Boolean);
  const normalized = configured && /^[0-9a-fA-F]{64}$/.test(configured)
    ? `0x${configured}`
    : configured;
  if (!normalized || !/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(
      `${variableNames.join(" or ")} must contain a 32-byte private key`
    );
  }
  return new Wallet(normalized, provider);
}

async function requestConfirmation(expectedPhrase) {
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      `Type exactly "${expectedPhrase}" to authorize one deployment transaction: `
    );
    return answer === expectedPhrase;
  } finally {
    prompt.close();
  }
}

function safeFailureMessage(error) {
  let message = error.shortMessage || error.message || "Deployment failed";
  for (const variableName of [
    "BOTCHAIN_TESTNET_RPC_URL",
    "BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY",
    "BOTCHAIN_TESTNET_DEPLOYER_PRIVATE_KEY",
    "BOTPASS_MAINNET_DEPLOYER_PRIVATE_KEY",
  ]) {
    const value = process.env[variableName];
    if (value) {
      message = message.split(value).join("[redacted]");
    }
  }
  return message;
}

async function runCli({
  args = process.argv.slice(2),
  projectRoot = PROJECT_ROOT,
  runCommand = runDeploymentCommand,
} = {}) {
  const [networkName, mode] = args;
  if (
    args.length !== 2 ||
    !["--inspect", "--authorize"].includes(mode)
  ) {
    throw new Error(
      "Use exactly testnet or mainnet followed by --inspect or --authorize"
    );
  }
  const network = selectNetwork(networkName);
  if (mode === "--authorize") {
    loadProjectEnvironment(projectRoot);
  }
  return runCommand({
    mode,
    network,
    projectRoot,
    outputPath: deploymentPath(projectRoot, network.chainId),
    createProvider: () =>
      new JsonRpcProvider(network.defaultRpcUrl, network.chainId, {
        staticNetwork: true,
      }),
    createSigner,
    confirm: requestConfirmation,
  });
}

async function main() {
  await runCli();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`BOTPass deployment refused or failed: ${safeFailureMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PROJECT_ROOT,
  createSigner,
  privateKeyVariable,
  privateKeyCandidates,
  requestConfirmation,
  runCli,
  safeFailureMessage,
  selectNetwork,
};
