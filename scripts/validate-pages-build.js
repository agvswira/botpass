"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseGeneratedConfig } = require("./generate-frontend-config");
const {
  validateGeneratedFrontend,
} = require("./lib/frontend-configuration");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NETWORK_IDENTITIES = Object.freeze([
  Object.freeze({
    networkName: "BOT Chain Mainnet",
    rpcUrl: "https://rpc.botchain.ai",
    explorerUrl: "https://scan.botchain.ai",
  }),
  Object.freeze({
    networkName: "BOT Chain Testnet",
    rpcUrl: "https://rpc.bohr.life",
    explorerUrl: "https://scan.bohr.life",
  }),
]);

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

function readGeneratedConfig(projectRoot) {
  const configPath = path.join(
    projectRoot,
    "frontend/src/contract-config.js"
  );
  return parseGeneratedConfig(fs.readFileSync(configPath, "utf8"));
}

function requireMarkers(source, markers, description) {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`${description} is missing ${marker}`);
    }
  }
}

function validatePagesBuild(projectRoot = PROJECT_ROOT) {
  const dist = path.join(projectRoot, "frontend/dist");
  const indexPath = path.join(dist, "index.html");
  const cnamePath = path.join(dist, "CNAME");
  if (!fs.existsSync(indexPath)) throw new Error("Built index.html is missing");
  if (
    !fs.existsSync(cnamePath) ||
    fs.readFileSync(cnamePath, "utf8") !== "botpass.online\n"
  ) {
    throw new Error("CNAME must contain exactly botpass.online");
  }

  const generated = validateGeneratedFrontend(projectRoot);
  const config = readGeneratedConfig(projectRoot);
  const index = fs.readFileSync(indexPath, "utf8");
  requireMarkers(
    index,
    [
      'rel="canonical" href="https://botpass.online/"',
      "Verifiable event passes",
      "How BOTPass works",
      "My Passes",
      "Loading network…",
    ],
    "Built page"
  );

  const staticNetworkMarkers = NETWORK_IDENTITIES.flatMap((network) => [
    network.networkName,
    network.rpcUrl,
    network.explorerUrl,
  ]);
  if (
    staticNetworkMarkers.some((marker) => index.includes(marker)) ||
    (config.contractAddress && index.includes(config.contractAddress))
  ) {
    throw new Error(
      "Built static page must not claim a network before initialization"
    );
  }

  const builtFiles = files(dist);
  const bundle = builtFiles
    .filter((file) => /\.(html|js|css)$/.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  requireMarkers(
    bundle,
    [
      config.environment,
      config.status,
      config.networkName,
      String(config.chainId),
      config.rpcUrl,
      config.explorerUrl,
      "getEvent(uint256)",
      "claimOpen",
      "claimedAt",
      ...(config.status === "active" ? [config.contractAddress] : []),
    ],
    "Built bundle"
  );

  for (const network of NETWORK_IDENTITIES) {
    if (network.networkName === config.networkName) continue;
    for (const marker of [
      network.networkName,
      network.rpcUrl,
      network.explorerUrl,
    ]) {
      if (bundle.includes(marker)) {
        throw new Error(`Built bundle claims ${marker}`);
      }
    }
  }

  for (const forbidden of [
    "claimWithSession",
    "api.qrserver.com",
    "BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY",
    "BOTPASS_MAINNET_DEPLOYER_PRIVATE_KEY",
    "BEGIN PRIVATE KEY",
  ]) {
    if (bundle.includes(forbidden)) {
      throw new Error(`Built bundle contains forbidden marker: ${forbidden}`);
    }
  }
  if (builtFiles.some((file) => path.basename(file).startsWith(".env"))) {
    throw new Error("Environment file included in build");
  }

  return {
    customDomain: "botpass.online",
    environment: generated.environment,
    deploymentStatus: generated.deploymentStatus,
    networkName: config.networkName,
    chainId: generated.chainId,
    rpcUrl: config.rpcUrl,
    explorerUrl: config.explorerUrl,
    contractAddress: config.status === "active" ? config.contractAddress : null,
    openClaimOnly: true,
    secretMarkerScan: "passed",
    files: builtFiles.map((file) => path.relative(dist, file)).sort(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(validatePagesBuild(), null, 2));
}

module.exports = {
  validatePagesBuild,
};
