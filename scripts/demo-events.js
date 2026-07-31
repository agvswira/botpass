"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { Contract, JsonRpcProvider, Wallet, getAddress } = require("ethers");
const { BOTCHAIN_TESTNET, getTestnetRpcUrl } = require("../config/botchain");
const { loadProjectEnvironment } = require("./lib/environment");
const { deploymentPath, loadFrozenArtifact, validateSelectedDeploymentRecord } = require("./lib/deployment");
const { TESTNET_EVENT_CONFIRMATION, buildTestnetDemoEvent, executeTestnetDemo } = require("./lib/demo-events");
const { assertTrackedSourceClean } = require("./lib/project");

const PROJECT_ROOT = path.resolve(__dirname, "..");

async function requestConfirmation(expected) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await prompt.question(`Type exactly "${expected}" to authorize event creation and opening: `)) === expected; }
  finally { prompt.close(); }
}

async function withProvider(provider, task) {
  try {
    return await task();
  } finally {
    provider.destroy();
  }
}

function loadRecord(projectRoot) {
  const recordPath = deploymentPath(projectRoot, 968);
  if (!fs.existsSync(recordPath)) throw new Error(`No fresh Testnet deployment record exists at ${recordPath}`);
  return validateSelectedDeploymentRecord(JSON.parse(fs.readFileSync(recordPath, "utf8")), { expectedChainId: 968, recordPath });
}

async function runCli({ args = process.argv.slice(2), projectRoot = PROJECT_ROOT } = {}) {
  const [networkName, mode] = args;
  if (networkName !== "testnet" || !["--inspect", "--authorize"].includes(mode) || args.length !== 2) {
    throw new Error("Use exactly testnet followed by --inspect or --authorize; Mainnet event writes are disabled");
  }
  const recordPath = deploymentPath(projectRoot, 968);
  const summary = {
    mode: mode.slice(2),
    networkName: BOTCHAIN_TESTNET.networkName,
    chainId: 968,
    contractAddress: fs.existsSync(recordPath) ? loadRecord(projectRoot).contractAddress : null,
    eventTemplate: buildTestnetDemoEvent(2_000_000_000),
    confirmationPhrase: TESTNET_EVENT_CONFIRMATION,
    mainnetWritesEnabled: false,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (mode === "--inspect") return summary;

  loadProjectEnvironment(projectRoot);
  assertTrackedSourceClean("BOTPass Testnet demo", projectRoot);
  const record = loadRecord(projectRoot);
  const configured = process.env.BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY?.trim() || process.env.BOTCHAIN_TESTNET_DEPLOYER_PRIVATE_KEY?.trim();
  const key = configured && /^[0-9a-fA-F]{64}$/.test(configured) ? `0x${configured}` : configured;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key || "")) throw new Error("BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY or BOTCHAIN_TESTNET_DEPLOYER_PRIVATE_KEY must contain a 32-byte private key");
  const provider = new JsonRpcProvider(getTestnetRpcUrl(), 968, { staticNetwork: true });
  return withProvider(provider, async () => {
    const signer = new Wallet(key, provider);
    if (getAddress(await signer.getAddress()) !== getAddress(record.deployerAddress)) throw new Error("Testnet demo signer must equal the deployment record deployer");
    const frozen = loadFrozenArtifact(projectRoot);
    return executeTestnetDemo({ provider, organizer: signer, contract: new Contract(record.contractAddress, frozen.artifact.abi, signer), confirm: requestConfirmation });
  });
}

if (require.main === module) runCli().catch((error) => { console.error(`BOTPass Testnet demo refused or failed: ${error.message}`); process.exitCode = 1; });

module.exports = { loadRecord, requestConfirmation, runCli, withProvider };
