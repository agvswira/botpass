"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { FRONTEND_ACTIVATIONS } = require("../config/frontend-activation");
const {
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  validateReviewedDeployment,
} = require("./lib/frontend-configuration");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ARTIFACT_PATH = path.join(
  PROJECT_ROOT,
  "artifacts/contracts/BOTPass.sol/BOTPass.json"
);
const ABI_OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  "frontend/src/abi/BOTPass.json"
);
const CONFIG_OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  "frontend/src/contract-config.js"
);

const NETWORKS = Object.freeze({
  production: Object.freeze({
    environment: "production",
    networkName: "BOT Chain Mainnet",
    chainId: MAINNET_CHAIN_ID,
    chainIdHex: "0x2A5",
    rpcUrl: "https://rpc.botchain.ai",
    explorerUrl: "https://scan.botchain.ai",
    faucetUrl: null,
  }),
  staging: Object.freeze({
    environment: "staging",
    networkName: "BOT Chain Testnet",
    chainId: TESTNET_CHAIN_ID,
    chainIdHex: "0x3C8",
    rpcUrl: "https://rpc.bohr.life",
    explorerUrl: "https://scan.bohr.life",
    faucetUrl: "https://faucet.botchain.ai/basic",
  }),
});

const REQUIRED_FUNCTIONS = Object.freeze([
  "claimedAt",
  "claimOpen",
  "createEvent",
  "eventCount",
  "getEvent",
  "setClaimOpen",
]);

const RELEVANT_ERRORS = Object.freeze([
  "AlreadyClaimed",
  "ClaimClosed",
  "EmptyField",
  "EndTimeNotFuture",
  "EventEnded",
  "EventNotFound",
  "EventNotStarted",
  "FieldTooLong",
  "InvalidTimeRange",
  "UnauthorizedOrganizer",
]);

const RELEVANT_EVENTS = Object.freeze([
  "ClaimOpenChanged",
  "EventCreated",
  "PassClaimed",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeEnvironment(value) {
  const environment = value || "staging";
  if (!Object.hasOwn(NETWORKS, environment)) {
    throw new Error(
      `BOTPass frontend environment must be production or staging, received ${environment}`
    );
  }
  return environment;
}

function generateMinimalAbi(artifact) {
  const allowed = new Set([
    ...REQUIRED_FUNCTIONS,
    ...RELEVANT_ERRORS,
    ...RELEVANT_EVENTS,
  ]);
  const abi = artifact.abi.filter(
    (entry) =>
      (entry.type === "function" ||
        entry.type === "error" ||
        entry.type === "event") &&
      allowed.has(entry.name)
  );

  for (const name of REQUIRED_FUNCTIONS) {
    if (!abi.some((entry) => entry.type === "function" && entry.name === name)) {
      throw new Error(`Canonical BOTPass artifact is missing ${name}()`);
    }
  }
  for (const name of RELEVANT_ERRORS) {
    if (!abi.some((entry) => entry.type === "error" && entry.name === name)) {
      throw new Error(`Canonical BOTPass artifact is missing ${name}`);
    }
  }
  for (const name of RELEVANT_EVENTS) {
    if (!abi.some((entry) => entry.type === "event" && entry.name === name)) {
      throw new Error(`Canonical BOTPass artifact is missing ${name}`);
    }
  }
  return abi;
}

function loadConfiguredDeployment(environment, activation) {
  if (!activation?.enabled) return null;
  const deploymentPath = path.join(
    PROJECT_ROOT,
    "deployments",
    `${NETWORKS[environment].chainId}.json`
  );
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      `Reviewed BOTPass activation has no deployment record at ${path.relative(
        PROJECT_ROOT,
        deploymentPath
      )}`
    );
  }
  return readJson(deploymentPath);
}

function validateConfiguredStagingEvidence({
  deployment,
}) {
  if (deployment.chainId !== TESTNET_CHAIN_ID) {
    throw new Error("Staging activation requires a canonical Testnet deployment");
  }
  return deployment;
}

function generateContractConfig({
  environment = "production",
  deployment = null,
  activation = null,
  acceptance = null,
  verificationResult = null,
} = {}) {
  const selectedEnvironment = normalizeEnvironment(environment);
  const network = NETWORKS[selectedEnvironment];
  const selectedActivation =
    activation ?? FRONTEND_ACTIVATIONS[selectedEnvironment];
  const selectedDeployment =
    deployment ?? loadConfiguredDeployment(selectedEnvironment, selectedActivation);

  let active = null;
  if (selectedDeployment || selectedActivation) {
    if (!selectedDeployment || !selectedActivation) {
      throw new Error(
        "BOTPass activation requires both a reviewed activation and a deployment record"
      );
    }
    active = validateReviewedDeployment(
      selectedDeployment,
      selectedActivation,
      selectedEnvironment
    );
    if (selectedEnvironment === "staging") {
      validateConfiguredStagingEvidence({
        deployment: active,
      });
    }
  }

  const config = {
    environment: selectedEnvironment,
    status: active ? "active" : "pending",
    networkName: network.networkName,
    chainId: network.chainId,
    chainIdHex: network.chainIdHex,
    rpcUrl: network.rpcUrl,
    explorerUrl: network.explorerUrl,
    faucetUrl: network.faucetUrl,
    nativeCurrency: {
      name: "BOT",
      symbol: "BOT",
      decimals: 18,
    },
    contractName: "BOTPass",
    contractAddress: active?.contractAddress ?? null,
    deploymentTransactionHash: active?.deploymentTransactionHash ?? null,
    activationReviewed: Boolean(active),
    sourceVerified: active?.verificationStatus === "verified",
    writesEnabled: Boolean(active),
  };

  return [
    "// Generated by scripts/generate-frontend-config.js.",
    "// Do not edit this file manually.",
    "",
    `export const FRONTEND_CONFIG = Object.freeze(${JSON.stringify(
      config,
      null,
      2
    )});`,
    "",
  ].join("\n");
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

function buildGeneratedOutputs({
  environment = process.env.BOTPASS_FRONTEND_ENVIRONMENT || "production",
  artifactPath = ARTIFACT_PATH,
  deployment = null,
  activation = null,
  acceptance = null,
  verificationResult = null,
} = {}) {
  const artifact = readJson(artifactPath);
  return {
    abi: `${JSON.stringify(generateMinimalAbi(artifact), null, 2)}\n`,
    config: generateContractConfig({
      environment,
      deployment,
      activation,
      acceptance,
      verificationResult,
    }),
  };
}

function writeGeneratedOutputs() {
  const outputs = buildGeneratedOutputs();
  fs.mkdirSync(path.dirname(ABI_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(ABI_OUTPUT_PATH, outputs.abi, "utf8");
  fs.writeFileSync(CONFIG_OUTPUT_PATH, outputs.config, "utf8");
  const config = parseGeneratedConfig(outputs.config);
  console.log(
    `Generated BOTPass frontend for ${config.environment} Chain ID ${config.chainId} (${config.status}).`
  );
}

if (require.main === module) {
  writeGeneratedOutputs();
}

module.exports = {
  ABI_OUTPUT_PATH,
  CONFIG_OUTPUT_PATH,
  NETWORKS,
  RELEVANT_ERRORS,
  RELEVANT_EVENTS,
  REQUIRED_FUNCTIONS,
  buildGeneratedOutputs,
  generateContractConfig,
  generateMinimalAbi,
  parseGeneratedConfig,
  validateConfiguredStagingEvidence,
  writeGeneratedOutputs,
};
