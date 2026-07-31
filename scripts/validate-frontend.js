"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  ABI_OUTPUT_PATH,
  CONFIG_OUTPUT_PATH,
  RELEVANT_ERRORS,
  RELEVANT_EVENTS,
  REQUIRED_FUNCTIONS,
  buildGeneratedOutputs,
  parseGeneratedConfig,
} = require("./generate-frontend-config");
const {
  validateGeneratedFrontend,
} = require("./lib/frontend-configuration");
const {
  validateFrontendStructure,
} = require("./lib/frontend-structure");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const FRONTEND_SOURCE = path.join(PROJECT_ROOT, "frontend/src");

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function validateGeneratedFiles() {
  const expected = buildGeneratedOutputs();
  if (fs.readFileSync(ABI_OUTPUT_PATH, "utf8") !== expected.abi) {
    throw new Error("Generated BOTPass frontend ABI is stale");
  }
  if (fs.readFileSync(CONFIG_OUTPUT_PATH, "utf8") !== expected.config) {
    throw new Error("Generated BOTPass frontend contract configuration is stale");
  }
  const abi = JSON.parse(expected.abi);
  const functions = abi
    .filter((entry) => entry.type === "function")
    .map((entry) => entry.name)
    .sort();
  const errors = abi
    .filter((entry) => entry.type === "error")
    .map((entry) => entry.name)
    .sort();
  const events = abi
    .filter((entry) => entry.type === "event")
    .map((entry) => entry.name)
    .sort();
  if (
    JSON.stringify(functions) !== JSON.stringify([...REQUIRED_FUNCTIONS].sort()) ||
    JSON.stringify(errors) !== JSON.stringify([...RELEVANT_ERRORS].sort()) ||
    JSON.stringify(events) !== JSON.stringify([...RELEVANT_EVENTS].sort())
  ) {
    throw new Error("Minimal BOTPass frontend ABI has an unexpected entry");
  }
  return parseGeneratedConfig(expected.config);
}

function validateSourceSafety(config) {
  const files = listFiles(FRONTEND_SOURCE).filter((file) =>
    /\.(m?js|css|json)$/.test(file)
  );
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const forbidden of [
    "eth_getLogs",
    "queryFilter",
    ".innerHTML",
    "BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY",
    "BOTPASS_MAINNET_DEPLOYER_PRIVATE_KEY",
    "BOTPASS_INITIAL_OWNER_ADDRESS",
    "api.qrserver.com",
    "chart.googleapis.com",
    "quickchart.io",
  ]) {
    if (source.includes(forbidden)) {
      throw new Error(`Frontend source contains forbidden token: ${forbidden}`);
    }
  }
  if (
    config.environment === "production" &&
    (source.includes("https://rpc.bohr.life") ||
      source.includes("https://scan.bohr.life"))
  ) {
    throw new Error("Production frontend source contains Testnet activation");
  }
  if (!source.includes('contract["getEvent(uint256)"]')) {
    throw new Error("BOTPass reads must call the full Solidity getEvent signature");
  }
}

const generatedConfig = validateGeneratedFiles();
validateSourceSafety(generatedConfig);
const isolation = validateGeneratedFrontend(PROJECT_ROOT);
const structure = validateFrontendStructure(PROJECT_ROOT);

console.log(
  JSON.stringify(
    {
      ...isolation,
      routeHooks: structure.routeHooks,
      generatedAbi: "BOTPass",
      openClaimOnly: true,
      unsafeHtmlAssignment: false,
      boundedPublicIndexes: 100,
    },
    null,
    2
  )
);
