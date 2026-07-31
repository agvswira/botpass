"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { keccak256 } = require("ethers");
const {
  FROZEN_CONTRACT,
  expectedImmutableValues,
  getNetwork,
  materializeExpectedRuntime,
  validateDeploymentRecord,
} = require("./deployment");

function buildVerificationBundle({ frozen, record }) {
  validateDeploymentRecord(record);
  const network = getNetwork(record.chainId);
  const immutableValues = expectedImmutableValues(
    record.chainId,
    record.contractAddress
  );
  const expectedRuntime = materializeExpectedRuntime({
    artifact: frozen.artifact,
    immutableReferences: frozen.immutableReferences,
    chainId: record.chainId,
    contractAddress: record.contractAddress,
  });
  if (keccak256(expectedRuntime) !== record.runtimeBytecodeKeccak256) {
    throw new Error(
      "Deployment record runtime hash does not match the exact frozen runtime and immutables"
    );
  }
  const immutableReferences = frozen.immutableReferences.map((reference) => ({
    ...reference,
    value: immutableValues[reference.name],
  }));
  return {
    standardInput: frozen.buildInfo.input,
    metadata: {
      schemaVersion: 1,
      preparationMode: "offline-record-bound",
      trustNotice:
        "This preparation step validates the frozen input and local record but does not query live chain state; Task 5 performs live transaction/runtime verification.",
      verificationStatus: record.verificationStatus,
      networkName: record.networkName,
      chainId: record.chainId,
      rpcOrigin: record.rpcOrigin,
      explorerUrl: record.explorerUrl,
      verificationPageUrl: `${network.explorerUrl}/contract-verification`,
      standardInputApiUrl: `${network.explorerUrl}/api/v2/smart-contracts/${record.contractAddress}/verification/via/standard-input`,
      contractAddress: record.contractAddress,
      deploymentTransactionHash: record.deploymentTransactionHash,
      deployedSourceCommit: record.sourceCommit,
      contractPath: FROZEN_CONTRACT.sourceName,
      contractName: FROZEN_CONTRACT.contractName,
      fullyQualifiedContractName: `${FROZEN_CONTRACT.sourceName}:${FROZEN_CONTRACT.contractName}`,
      licenseType: "mit",
      compilerVersion: FROZEN_CONTRACT.compilerVersion,
      compilerLongVersion: FROZEN_CONTRACT.compilerLongVersion,
      optimizer: {
        enabled: FROZEN_CONTRACT.optimizerEnabled,
        runs: FROZEN_CONTRACT.optimizerRuns,
      },
      evmVersion: FROZEN_CONTRACT.evmVersion,
      constructorArguments: [],
      standardInputSha256: FROZEN_CONTRACT.standardInputSha256,
      creationBytecodeKeccak256: FROZEN_CONTRACT.creationBytecodeKeccak256,
      runtimeTemplateKeccak256: FROZEN_CONTRACT.runtimeTemplateKeccak256,
      deployedRuntimeKeccak256: record.runtimeBytecodeKeccak256,
      immutableValues,
      immutableReferences,
    },
  };
}

async function writeVerificationBundle({
  projectRoot,
  frozen,
  record,
  fsApi = fs,
}) {
  const bundle = buildVerificationBundle({ frozen, record });
  const parent = path.join(projectRoot, `verification/${record.chainId}`);
  const outputDirectory = path.join(parent, record.contractAddress);
  await fsApi.mkdir(parent, { recursive: true });
  try {
    await fsApi.mkdir(outputDirectory);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `Verification bundle already exists at ${outputDirectory}`
      );
    }
    throw error;
  }
  try {
    await fsApi.writeFile(
      path.join(outputDirectory, "standard-input.json"),
      `${JSON.stringify(bundle.standardInput, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o644 }
    );
    await fsApi.writeFile(
      path.join(outputDirectory, "metadata.json"),
      `${JSON.stringify(bundle.metadata, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o644 }
    );
  } catch (error) {
    await fsApi.rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
  return outputDirectory;
}

module.exports = {
  buildVerificationBundle,
  writeVerificationBundle,
};
