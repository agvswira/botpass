"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  deploymentPath,
  getNetwork,
  loadFrozenArtifact,
  validateSelectedDeploymentRecord,
} = require("./lib/deployment");
const {
  writeVerificationBundle,
} = require("./lib/verification");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function readDeploymentRecord(projectRoot, chainId) {
  const recordPath = deploymentPath(projectRoot, chainId);
  if (!fs.existsSync(recordPath)) {
    throw new Error(
      `No real BOTPass deployment record exists at ${recordPath}`
    );
  }
  return validateSelectedDeploymentRecord(
    JSON.parse(fs.readFileSync(recordPath, "utf8")),
    {
      expectedChainId: chainId,
      recordPath,
    }
  );
}

async function runCli({
  args = process.argv.slice(2),
  projectRoot = PROJECT_ROOT,
} = {}) {
  const [networkName] = args;
  const chainId =
    networkName === "testnet"
      ? 968
      : networkName === "mainnet"
        ? 677
        : null;
  if (chainId === null || args.length !== 1) {
    throw new Error("Select exactly testnet or mainnet");
  }
  const network = getNetwork(chainId);
  const record = readDeploymentRecord(projectRoot, network.chainId);
  const frozen = loadFrozenArtifact(projectRoot);
  const outputDirectory = await writeVerificationBundle({
    projectRoot,
    frozen,
    record,
  });
  console.log(`BOTPass verification bundle written to ${outputDirectory}`);
  return outputDirectory;
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`BOTPass verification preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PROJECT_ROOT,
  readDeploymentRecord,
  runCli,
};
