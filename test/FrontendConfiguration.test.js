"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { expect } = require("chai");
const {
  REQUIRED_FUNCTIONS,
  RELEVANT_EVENTS,
  buildGeneratedOutputs,
  parseGeneratedConfig,
} = require("../scripts/generate-frontend-config");
const {
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  validateGeneratedFrontend,
} = require("../scripts/lib/frontend-configuration");
const { validateFrontendStructure } = require("../scripts/lib/frontend-structure");
const { BOTCHAIN_MAINNET, BOTCHAIN_TESTNET } = require("../config/botchain");
const { buildDeploymentRecord } = require("../scripts/lib/deployment");

describe("BOTPass frontend configuration", function () {
  const projectRoot = path.resolve(__dirname, "..");

  function validateConfigSource(source) {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "botpass-frontend-config-")
    );
    const configPath = path.join(
      temporaryRoot,
      "frontend",
      "src",
      "contract-config.js"
    );
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, source, "utf8");
    try {
      return validateGeneratedFrontend(temporaryRoot);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  it("binds the public demo to the reviewed fresh Testnet deployment", function () {
    const output = buildGeneratedOutputs({ environment: "staging" });
    const config = parseGeneratedConfig(output.config);
    expect(config).to.include({
      environment: "staging",
      status: "active",
      chainId: TESTNET_CHAIN_ID,
      contractAddress: "0x2ea9E965433D8f42F9C0caa8BC223335f8e14f6C",
      activationReviewed: true,
      writesEnabled: true,
    });
    expect(output.abi).not.to.match(/claimWithSession|tokenOf|ownerOf|tokenURI/);
  });

  it("defaults the public build to the confirmed Mainnet deployment receipt", function () {
    const config = parseGeneratedConfig(
      buildGeneratedOutputs().config
    );
    expect(config).to.include({
      environment: "production",
      status: "active",
      chainId: MAINNET_CHAIN_ID,
      contractAddress: "0x41fc0234A8f94482168B063FDE7ABE67043E68A4",
      deploymentTransactionHash:
        "0xb86877c47c9b6b937f0142245d2c6e9083ed73e87d5b36b063d0624f43a7105f",
      activationReviewed: true,
      sourceVerified: false,
      writesEnabled: true,
    });
  });

  it("generates only the compact Open Claim ABI", function () {
    const abi = JSON.parse(buildGeneratedOutputs().abi);
    expect(abi.filter(({ type }) => type === "function").map(({ name }) => name).sort()).to.deep.equal([...REQUIRED_FUNCTIONS].sort());
    expect(abi.filter(({ type }) => type === "event").map(({ name }) => name).sort()).to.deep.equal([...RELEVANT_EVENTS].sort());
  });

  it("can generate a truthful Mainnet-pending view when activation is disabled", function () {
    const config = parseGeneratedConfig(
      buildGeneratedOutputs({
        environment: "production",
        activation: false,
      }).config
    );
    expect(config).to.include({
      environment: "production",
      status: "pending",
      chainId: MAINNET_CHAIN_ID,
      contractAddress: null,
      activationReviewed: false,
      writesEnabled: false,
    });
  });

  it("enables writes only for an active reviewed deployment", function () {
    const deployment = (network) => buildDeploymentRecord({
      network,
      contractAddress: "0x1111111111111111111111111111111111111111",
      deployerAddress: network.intendedDeployer,
      deploymentTransactionHash: `0x${"22".repeat(32)}`,
      deploymentBlockNumber: 123,
      deploymentTimestampUtc: "2026-07-31T01:02:03.000Z",
      sourceCommit: "a".repeat(40),
      runtimeBytecodeKeccak256: `0x${"33".repeat(32)}`,
    });
    const activation = (record) => ({
      enabled: true,
      reviewed: true,
      chainId: record.chainId,
      contractAddress: record.contractAddress,
      deploymentTransactionHash: record.deploymentTransactionHash,
    });
    const testnet = deployment(BOTCHAIN_TESTNET);
    const mainnet = deployment(BOTCHAIN_MAINNET);
    expect(parseGeneratedConfig(buildGeneratedOutputs({ environment: "staging", deployment: testnet, activation: activation(testnet) }).config).writesEnabled).to.equal(true);
    expect(parseGeneratedConfig(buildGeneratedOutputs({ environment: "production", deployment: mainnet, activation: activation(mainnet) }).config).writesEnabled).to.equal(true);
  });

  it("validates active reviewed Testnet and Mainnet configurations with writes enabled", function () {
    const deployment = (network) => buildDeploymentRecord({
      network,
      contractAddress: "0x1111111111111111111111111111111111111111",
      deployerAddress: network.intendedDeployer,
      deploymentTransactionHash: `0x${"22".repeat(32)}`,
      deploymentBlockNumber: 123,
      deploymentTimestampUtc: "2026-07-31T01:02:03.000Z",
      sourceCommit: "a".repeat(40),
      runtimeBytecodeKeccak256: `0x${"33".repeat(32)}`,
    });
    const activation = (record) => ({
      enabled: true,
      reviewed: true,
      chainId: record.chainId,
      contractAddress: record.contractAddress,
      deploymentTransactionHash: record.deploymentTransactionHash,
    });
    const testnet = deployment(BOTCHAIN_TESTNET);
    const mainnet = deployment(BOTCHAIN_MAINNET);
    const generated = (environment, record) =>
      buildGeneratedOutputs({
        environment,
        deployment: record,
        activation: activation(record),
      }).config;

    expect(validateConfigSource(generated("staging", testnet))).to.deep.equal({
      environment: "staging",
      chainId: TESTNET_CHAIN_ID,
      deploymentStatus: "active",
    });
    expect(validateConfigSource(generated("production", mainnet))).to.deep.equal({
      environment: "production",
      chainId: MAINNET_CHAIN_ID,
      deploymentStatus: "active",
    });
    expect(() =>
      validateConfigSource(
        generated("production", mainnet).replace(
          '"writesEnabled": true',
          '"writesEnabled": false'
        )
      )
    ).to.throw("BOTPass writes require an active reviewed deployment");
  });

  it("validates the checked-in active production configuration", function () {
    expect(validateGeneratedFrontend(projectRoot)).to.deep.equal({ environment: "production", chainId: MAINNET_CHAIN_ID, deploymentStatus: "active" });
  });

  it("requires the menu routes, English guide, and anchored footer", function () {
    expect(validateFrontendStructure(projectRoot)).to.deep.include({
      routeHooks: ["home", "create", "manage", "event", "passes", "verify", "guide"],
      semanticLandmarks: ["header", "nav", "main", "footer"],
      shortPageFooterAnchored: true,
      mobileFooterAnchored: true,
      scanLimit: 100,
      guideFollowsMenu: true,
      publicTerminology: "pass",
      currentFlowOnly: true,
      functionalLayout: true,
      statusPresentation: "inline",
    });
  });
});
