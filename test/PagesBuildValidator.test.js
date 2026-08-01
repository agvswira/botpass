"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { expect } = require("chai");
const {
  buildGeneratedOutputs,
  parseGeneratedConfig,
} = require("../scripts/generate-frontend-config");
const { validatePagesBuild } = require("../scripts/validate-pages-build");
const { BOTCHAIN_MAINNET } = require("../config/botchain");
const { buildDeploymentRecord } = require("../scripts/lib/deployment");

const projectRoot = path.resolve(__dirname, "..");

function writeFile(root, relativePath, source) {
  const outputPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, source, "utf8");
}

function neutralIndex(extra = "") {
  return [
    '<link rel="canonical" href="https://botpass.online/">',
    "Verifiable event passes",
    "How BOTPass works",
    "My Passes",
    '<strong id="deployment-title">Loading network status…</strong>',
    '<span id="footer-network-label">Loading network…</span>',
    extra,
  ].join("\n");
}

function createBuildFixture(configSource, { bundleExtra = "", indexExtra = "" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "botpass-pages-build-"));
  const config = parseGeneratedConfig(configSource);
  const bundle = [
    JSON.stringify(config),
    "getEvent(uint256)",
    "claimOpen",
    "claimedAt",
    bundleExtra,
  ].join("\n");
  writeFile(root, "frontend/src/contract-config.js", configSource);
  writeFile(root, "frontend/dist/CNAME", "botpass.online\n");
  writeFile(root, "frontend/dist/index.html", neutralIndex(indexExtra));
  writeFile(root, "frontend/dist/assets/app.js", bundle);
  return root;
}

function removeFixture(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function reviewedMainnetConfig() {
  const deployment = buildDeploymentRecord({
    network: BOTCHAIN_MAINNET,
    contractAddress: "0x1111111111111111111111111111111111111111",
    deployerAddress: BOTCHAIN_MAINNET.intendedDeployer,
    deploymentTransactionHash: `0x${"22".repeat(32)}`,
    deploymentBlockNumber: 123,
    deploymentTimestampUtc: "2026-07-31T01:02:03.000Z",
    sourceCommit: "a".repeat(40),
    runtimeBytecodeKeccak256: `0x${"33".repeat(32)}`,
  });
  const activation = {
    enabled: true,
    reviewed: true,
    chainId: deployment.chainId,
    contractAddress: deployment.contractAddress,
    deploymentTransactionHash: deployment.deploymentTransactionHash,
  };
  return buildGeneratedOutputs({
    environment: "production",
    deployment,
    activation,
  }).config;
}

describe("BOTPass Pages build validator", function () {
  it("accepts a build matching the current active Testnet configuration", function () {
    const configSource = fs.readFileSync(
      path.join(projectRoot, "frontend/src/contract-config.js"),
      "utf8"
    );
    const root = createBuildFixture(configSource);
    try {
      expect(validatePagesBuild(root)).to.deep.include({
        environment: "staging",
        deploymentStatus: "active",
        networkName: "BOT Chain Testnet",
        chainId: 968,
      });
    } finally {
      removeFixture(root);
    }
  });

  it("accepts a build matching a reviewed active Mainnet configuration", function () {
    const root = createBuildFixture(reviewedMainnetConfig());
    try {
      expect(validatePagesBuild(root)).to.deep.include({
        environment: "production",
        deploymentStatus: "active",
        networkName: "BOT Chain Mainnet",
        chainId: 677,
      });
    } finally {
      removeFixture(root);
    }
  });

  it("rejects wrong-network claims in either the bundle or static page", function () {
    const configSource = reviewedMainnetConfig();
    const wrongBundleRoot = createBuildFixture(configSource, {
      bundleExtra: "BOT Chain Testnet https://rpc.bohr.life https://scan.bohr.life",
    });
    const wrongStaticRoot = createBuildFixture(configSource, {
      indexExtra: "BOT Chain Testnet https://scan.bohr.life",
    });
    try {
      expect(() => validatePagesBuild(wrongBundleRoot)).to.throw(
        "Built bundle claims BOT Chain Testnet"
      );
      expect(() => validatePagesBuild(wrongStaticRoot)).to.throw(
        "Built static page must not claim a network before initialization"
      );
    } finally {
      removeFixture(wrongBundleRoot);
      removeFixture(wrongStaticRoot);
    }
  });
});
