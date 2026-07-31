"use strict";

const path = require("node:path");
const { JsonRpcProvider } = require("ethers");
const { loadFrozenArtifact, getNetwork, inspectLiveDeployment } = require("./lib/deployment");

const PROJECT_ROOT = path.resolve(__dirname, "..");

async function runCli({ args = process.argv.slice(2), projectRoot = PROJECT_ROOT } = {}) {
  const [selection] = args;
  if (args.length !== 1 || !["testnet", "mainnet"].includes(selection)) {
    throw new Error("Use exactly testnet or mainnet");
  }
  const network = getNetwork(selection === "testnet" ? 968 : 677);
  const provider = new JsonRpcProvider(network.defaultRpcUrl, network.chainId, { staticNetwork: true });
  try {
    const result = await inspectLiveDeployment({ provider, network, frozen: loadFrozenArtifact(projectRoot) });
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally { provider.destroy(); }
}

if (require.main === module) runCli().catch((error) => { console.error(`BOTPass live preflight failed: ${error.message}`); process.exitCode = 1; });

module.exports = { runCli };
