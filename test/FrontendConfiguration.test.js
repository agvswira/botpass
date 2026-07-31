"use strict";

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

  it("defaults the public demo to a truthful fresh-Testnet pending state", function () {
    const output = buildGeneratedOutputs();
    const config = parseGeneratedConfig(output.config);
    expect(config).to.include({
      environment: "staging",
      status: "pending",
      chainId: TESTNET_CHAIN_ID,
      contractAddress: null,
      activationReviewed: false,
      writesEnabled: false,
    });
    expect(output.abi).not.to.match(/claimWithSession|tokenOf|ownerOf|tokenURI/);
  });

  it("generates only the compact Open Claim ABI", function () {
    const abi = JSON.parse(buildGeneratedOutputs().abi);
    expect(abi.filter(({ type }) => type === "function").map(({ name }) => name).sort()).to.deep.equal([...REQUIRED_FUNCTIONS].sort());
    expect(abi.filter(({ type }) => type === "event").map(({ name }) => name).sort()).to.deep.equal([...RELEVANT_EVENTS].sort());
  });

  it("can still generate a truthful Mainnet-pending submission view", function () {
    const config = parseGeneratedConfig(buildGeneratedOutputs({ environment: "production" }).config);
    expect(config).to.include({ environment: "production", status: "pending", chainId: MAINNET_CHAIN_ID, contractAddress: null });
  });

  it("enables writes only for an active Testnet deployment", function () {
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
    expect(parseGeneratedConfig(buildGeneratedOutputs({ environment: "production", deployment: mainnet, activation: activation(mainnet) }).config).writesEnabled).to.equal(false);
  });

  it("validates the checked-in staging configuration", function () {
    expect(validateGeneratedFrontend(projectRoot)).to.deep.equal({ environment: "staging", chainId: TESTNET_CHAIN_ID, deploymentStatus: "pending" });
  });

  it("requires the menu routes, English guide, and anchored footer", function () {
    expect(validateFrontendStructure(projectRoot)).to.deep.include({
      routeHooks: ["home", "create", "manage", "event", "passes", "verify", "guide"],
      semanticLandmarks: ["header", "nav", "main", "footer"],
      shortPageFooterAnchored: true,
      mobileFooterAnchored: true,
      scanLimit: 100,
      guideFollowsMenu: true,
    });
  });
});
