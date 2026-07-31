"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  ContractFactory,
  formatEther,
  formatUnits,
  getAddress,
  getCreateAddress,
  isAddress,
  keccak256,
  parseEther,
  ZeroAddress,
} = require("ethers");
const { BOTCHAIN_MAINNET, BOTCHAIN_TESTNET } = require("../../config/botchain");
const {
  assertTrackedSourceClean,
  getSourceCommit,
} = require("./project");

const FROZEN_CONTRACT = Object.freeze({
  contractName: "BOTPass",
  sourceName: "contracts/BOTPass.sol",
  canonicalArtifactSha256:
    "173132f6838b766fa4ada83e2768375e618968bb606ee4df7acfb55db35921aa",
  standardInputSha256:
    "616a364b407873de9042f05e356da3192742aa76cf2902154c92855187c1dc62",
  creationBytecodeKeccak256:
    "0xbface20e53837185586983bee1c357c133d02622839c63f2c6a7a344f2433467",
  runtimeTemplateKeccak256:
    "0x1796b394c32c64eccc1d87d2db330eaf85aa80013945174b3c87787289c560ab",
  creationBytecodeSize: 3652,
  runtimeBytecodeSize: 3620,
  compilerVersion: "0.8.20",
  compilerLongVersion: "0.8.20+commit.a1b79de6",
  evmVersion: "paris",
  optimizerEnabled: true,
  optimizerRuns: 200,
});

const MAX_DEPLOY_GAS = 1_400_000n;
const MAINNET_DEPLOY_BUDGET = parseEther("0.0389");

const CONFIRMATION_PHRASES = Object.freeze({
  [BOTCHAIN_TESTNET.chainId]:
    "DEPLOY BOTPASS TO BOT CHAIN TESTNET 968",
  [BOTCHAIN_MAINNET.chainId]:
    "DEPLOY BOTPASS TO BOT CHAIN MAINNET 677",
});

const RECORD_FIELDS = Object.freeze([
  "schemaVersion",
  "networkName",
  "chainId",
  "rpcOrigin",
  "explorerUrl",
  "faucetUrl",
  "contractName",
  "contractAddress",
  "deployerAddress",
  "deploymentTransactionHash",
  "deploymentBlockNumber",
  "deploymentTimestampUtc",
  "compilerVersion",
  "compilerLongVersion",
  "evmVersion",
  "optimizerEnabled",
  "optimizerRuns",
  "constructorArguments",
  "creationBytecodeSize",
  "runtimeBytecodeSize",
  "creationBytecodeKeccak256",
  "runtimeBytecodeKeccak256",
  "standardInputSha256",
  "sourceCommit",
  "verificationStatus",
]);

const EXPECTED_IMMUTABLES = Object.freeze([]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalArtifact(artifact) {
  return JSON.stringify({
    contractName: artifact.contractName,
    sourceName: artifact.sourceName,
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    deployedBytecode: artifact.deployedBytecode,
    linkReferences: artifact.linkReferences,
    deployedLinkReferences: artifact.deployedLinkReferences,
  });
}

function collectImportedSources(ast) {
  const imports = [];

  function walk(value) {
    if (!value || typeof value !== "object") {
      return;
    }
    if (
      value.nodeType === "ImportDirective" &&
      typeof value.absolutePath === "string"
    ) {
      imports.push(value.absolutePath);
    }
    for (const child of Object.values(value)) {
      walk(child);
    }
  }

  walk(ast);
  return imports;
}

function canonicalBuildInfo(buildInfo) {
  const inputSources = buildInfo?.input?.sources;
  const outputSources = buildInfo?.output?.sources;
  if (!inputSources || !outputSources) {
    throw new Error("Compiler build info is missing source input or AST output");
  }

  const required = new Set();
  const pending = [FROZEN_CONTRACT.sourceName];
  while (pending.length > 0) {
    const sourceName = pending.pop();
    if (required.has(sourceName)) {
      continue;
    }
    if (!inputSources[sourceName] || !outputSources[sourceName]?.ast) {
      throw new Error(`Compiler build info is missing source ${sourceName}`);
    }
    required.add(sourceName);
    pending.push(...collectImportedSources(outputSources[sourceName].ast));
  }

  const sources = Object.fromEntries(
    Object.entries(inputSources).filter(([sourceName]) =>
      required.has(sourceName)
    )
  );
  if (Object.keys(sources).length !== required.size) {
    throw new Error("Compiler input does not contain the complete import graph");
  }
  return {
    ...buildInfo,
    input: {
      ...buildInfo.input,
      sources,
    },
  };
}

function getNetwork(networkOrChainId) {
  const chainId =
    typeof networkOrChainId === "object"
      ? networkOrChainId.chainId
      : Number(networkOrChainId);
  if (chainId === BOTCHAIN_TESTNET.chainId) {
    return BOTCHAIN_TESTNET;
  }
  if (chainId === BOTCHAIN_MAINNET.chainId) {
    return {
      ...BOTCHAIN_MAINNET,
      faucetUrl: null,
    };
  }
  throw new Error(`Unsupported BOTPass chain ID ${chainId}`);
}

function deploymentPath(projectRoot, chainId) {
  getNetwork(chainId);
  return path.join(projectRoot, `deployments/${chainId}.json`);
}

function collectAstVariables(buildInfo) {
  const variables = new Map();

  function walk(value) {
    if (!value || typeof value !== "object") {
      return;
    }
    if (
      value.nodeType === "VariableDeclaration" &&
      Number.isSafeInteger(value.id)
    ) {
      variables.set(String(value.id), {
        name: value.name,
        type: value.typeDescriptions?.typeString,
      });
    }
    for (const child of Object.values(value)) {
      walk(child);
    }
  }

  for (const source of Object.values(buildInfo.output?.sources || {})) {
    walk(source.ast);
  }
  return variables;
}

function deriveImmutableReferences(buildInfo, runtimeByteLength) {
  const compilerContract =
    buildInfo.output?.contracts?.[FROZEN_CONTRACT.sourceName]?.[
      FROZEN_CONTRACT.contractName
    ];
  const rawReferences =
    compilerContract?.evm?.deployedBytecode?.immutableReferences;
  if (!rawReferences || typeof rawReferences !== "object") {
    throw new Error(
      "Compiler output is missing deployedBytecode immutableReferences"
    );
  }

  const variables = collectAstVariables(buildInfo);
  const references = [];
  for (const [astId, locations] of Object.entries(rawReferences)) {
    const variable = variables.get(astId);
    if (!variable || !Array.isArray(locations)) {
      throw new Error(`Immutable AST reference ${astId} is not authoritative`);
    }
    for (const location of locations) {
      if (
        !Number.isSafeInteger(location.start) ||
        !Number.isSafeInteger(location.length) ||
        location.start < 0 ||
        location.length !== 32 ||
        location.start + location.length > runtimeByteLength
      ) {
        throw new Error(`Immutable ${variable.name} has an invalid byte range`);
      }
      references.push({
        astId,
        name: variable.name,
        type: variable.type,
        start: location.start,
        length: location.length,
      });
    }
  }

  references.sort((left, right) => left.start - right.start);
  const names = references.map((reference) => reference.name).sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify([...EXPECTED_IMMUTABLES].sort())
  ) {
    throw new Error(
      `Unexpected immutable set in compiler output: ${names.join(", ")}`
    );
  }
  for (let index = 1; index < references.length; index += 1) {
    const previous = references[index - 1];
    const current = references[index];
    if (previous.start + previous.length > current.start) {
      throw new Error("Compiler immutable references overlap");
    }
  }
  return references;
}

function assertFrozenArtifact(artifact, buildInfo) {
  const compilerContract =
    buildInfo?.output?.contracts?.[FROZEN_CONTRACT.sourceName]?.[
      FROZEN_CONTRACT.contractName
    ];
  const settings = buildInfo?.input?.settings;
  const creationSize = (artifact.bytecode.length - 2) / 2;
  const runtimeSize = (artifact.deployedBytecode.length - 2) / 2;
  if (
    artifact.contractName !== FROZEN_CONTRACT.contractName ||
    artifact.sourceName !== FROZEN_CONTRACT.sourceName ||
    sha256(canonicalArtifact(artifact)) !==
      FROZEN_CONTRACT.canonicalArtifactSha256 ||
    sha256(JSON.stringify(buildInfo.input)) !==
      FROZEN_CONTRACT.standardInputSha256 ||
    keccak256(artifact.bytecode) !==
      FROZEN_CONTRACT.creationBytecodeKeccak256 ||
    keccak256(artifact.deployedBytecode) !==
      FROZEN_CONTRACT.runtimeTemplateKeccak256 ||
    creationSize !== FROZEN_CONTRACT.creationBytecodeSize ||
    runtimeSize !== FROZEN_CONTRACT.runtimeBytecodeSize ||
    compilerContract?.evm?.bytecode?.object !== artifact.bytecode.slice(2) ||
    compilerContract?.evm?.deployedBytecode?.object !==
      artifact.deployedBytecode.slice(2)
  ) {
    throw new Error("BOTPass artifact and compiler input are not frozen");
  }
  if (
    buildInfo.solcVersion !== FROZEN_CONTRACT.compilerVersion ||
    buildInfo.solcLongVersion !== FROZEN_CONTRACT.compilerLongVersion ||
    settings?.evmVersion !== FROZEN_CONTRACT.evmVersion ||
    settings?.optimizer?.enabled !== FROZEN_CONTRACT.optimizerEnabled ||
    settings?.optimizer?.runs !== FROZEN_CONTRACT.optimizerRuns
  ) {
    throw new Error("BOTPass compiler settings are not frozen");
  }
  const constructor = artifact.abi.find((entry) => entry.type === "constructor");
  if (constructor && constructor.inputs.length !== 0) {
    throw new Error("BOTPass must have no constructor arguments");
  }
  const immutableReferences = deriveImmutableReferences(
    buildInfo,
    runtimeSize
  );
  return { artifact, buildInfo, immutableReferences };
}

function loadFrozenArtifact(projectRoot) {
  const artifactPath = path.join(
    projectRoot,
    "artifacts/contracts/BOTPass.sol/BOTPass.json"
  );
  const debugPath = path.join(
    projectRoot,
    "artifacts/contracts/BOTPass.sol/BOTPass.dbg.json"
  );
  if (!fs.existsSync(artifactPath) || !fs.existsSync(debugPath)) {
    throw new Error("Compile BOTPass before inspecting or deploying");
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const debug = JSON.parse(fs.readFileSync(debugPath, "utf8"));
  const buildInfoPath = path.resolve(path.dirname(debugPath), debug.buildInfo);
  const compiledBuildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
  const currentSourcePath = path.join(projectRoot, FROZEN_CONTRACT.sourceName);
  const frozenSource =
    compiledBuildInfo.input?.sources?.[FROZEN_CONTRACT.sourceName]?.content;
  if (
    typeof frozenSource !== "string" ||
    !fs.existsSync(currentSourcePath) ||
    fs.readFileSync(currentSourcePath, "utf8") !== frozenSource
  ) {
    throw new Error(
      "The current BOTPass source differs from the frozen compiler input"
    );
  }
  const buildInfo = canonicalBuildInfo(compiledBuildInfo);
  return {
    ...assertFrozenArtifact(artifact, buildInfo),
    artifactPath,
    buildInfoPath,
  };
}

function expectedImmutableValues() {
  return {};
}

function materializeExpectedRuntime({
  artifact,
  immutableReferences,
  chainId,
  contractAddress,
}) {
  const runtime = Buffer.from(artifact.deployedBytecode.slice(2), "hex");
  const immutableValues = expectedImmutableValues(chainId, contractAddress);
  for (const reference of immutableReferences) {
    const value = immutableValues[reference.name];
    if (!value || (value.length - 2) / 2 !== reference.length) {
      throw new Error(`No exact value is defined for ${reference.name}`);
    }
    Buffer.from(value.slice(2), "hex").copy(runtime, reference.start);
  }
  return `0x${runtime.toString("hex")}`;
}

function validateDeployedRuntime({
  runtimeCode,
  artifact,
  immutableReferences,
  chainId,
  contractAddress,
}) {
  if (runtimeCode === "0x" || runtimeCode === "0x0") {
    throw new Error("Deployed address has empty runtime bytecode");
  }
  const expectedRuntime = materializeExpectedRuntime({
    artifact,
    immutableReferences,
    chainId,
    contractAddress,
  });
  if (runtimeCode.toLowerCase() !== expectedRuntime.toLowerCase()) {
    throw new Error(
      "Deployed runtime does not match the exact frozen bytecode"
    );
  }
  return {
    runtimeBytecodeKeccak256: keccak256(runtimeCode),
    immutableValues: expectedImmutableValues(chainId, contractAddress),
  };
}

function assertSafeInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(
      `${field} must be a safe integer greater than or equal to ${minimum}`
    );
  }
}

function validateDeploymentRecord(record) {
  const keys = Object.keys(record);
  const missing = RECORD_FIELDS.filter((field) => !(field in record));
  const unexpected = keys.filter((field) => !RECORD_FIELDS.includes(field));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Invalid deployment record fields; missing: ${
        missing.join(", ") || "none"
      }; unexpected: ${unexpected.join(", ") || "none"}`
    );
  }

  if (
    !Number.isSafeInteger(record.chainId) ||
    ![BOTCHAIN_TESTNET.chainId, BOTCHAIN_MAINNET.chainId].includes(
      record.chainId
    )
  ) {
    throw new Error("chainId must be the canonical safe integer 968 or 677");
  }
  const network = getNetwork(record.chainId);
  if (
    record.schemaVersion !== 1 ||
    record.networkName !== network.networkName
  ) {
    throw new Error("Deployment identity is invalid");
  }
  if (
    record.rpcOrigin !== new URL(network.defaultRpcUrl).origin ||
    record.explorerUrl !== network.explorerUrl ||
    record.faucetUrl !== (network.faucetUrl || null)
  ) {
    throw new Error("Deployment network metadata is invalid");
  }
  if (record.contractName !== FROZEN_CONTRACT.contractName) {
    throw new Error("contractName must be BOTPass");
  }
  for (const field of ["contractAddress", "deployerAddress"]) {
    if (!isAddress(record[field]) || getAddress(record[field]) === ZeroAddress) {
      throw new Error(`${field} must be a nonzero address`);
    }
    if (record[field] !== getAddress(record[field])) {
      throw new Error(`${field} must use its canonical checksummed address`);
    }
  }
  if (getAddress(record.deployerAddress) !== getAddress(network.intendedDeployer)) {
    throw new Error("deployerAddress must equal the reviewed network deployer");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(record.deploymentTransactionHash)) {
    throw new Error("deploymentTransactionHash must be a transaction hash");
  }
  if (!/^[0-9a-f]{40}$/.test(record.sourceCommit)) {
    throw new Error("sourceCommit must be a full lowercase Git commit");
  }
  if (
    !Array.isArray(record.constructorArguments) ||
    record.constructorArguments.length !== 0
  ) {
    throw new Error("constructorArguments must be empty");
  }
  if (
    typeof record.deploymentTimestampUtc !== "string" ||
    Number.isNaN(Date.parse(record.deploymentTimestampUtc)) ||
    new Date(record.deploymentTimestampUtc).toISOString() !==
      record.deploymentTimestampUtc
  ) {
    throw new Error("deploymentTimestampUtc must be a canonical ISO timestamp");
  }
  for (const [field, minimum] of [
    ["deploymentBlockNumber", 0],
    ["optimizerRuns", 0],
    ["creationBytecodeSize", 1],
    ["runtimeBytecodeSize", 1],
  ]) {
    assertSafeInteger(record[field], field, minimum);
  }
  if (
    record.compilerVersion !== FROZEN_CONTRACT.compilerVersion ||
    record.compilerLongVersion !== FROZEN_CONTRACT.compilerLongVersion ||
    record.evmVersion !== FROZEN_CONTRACT.evmVersion ||
    record.optimizerEnabled !== FROZEN_CONTRACT.optimizerEnabled ||
    record.optimizerRuns !== FROZEN_CONTRACT.optimizerRuns ||
    record.creationBytecodeSize !== FROZEN_CONTRACT.creationBytecodeSize ||
    record.runtimeBytecodeSize !== FROZEN_CONTRACT.runtimeBytecodeSize ||
    record.creationBytecodeKeccak256 !==
      FROZEN_CONTRACT.creationBytecodeKeccak256 ||
    record.standardInputSha256 !== FROZEN_CONTRACT.standardInputSha256
  ) {
    throw new Error("Deployment compiler or bytecode metadata is invalid");
  }
  if (!/^0x[0-9a-f]{64}$/.test(record.runtimeBytecodeKeccak256)) {
    throw new Error("runtimeBytecodeKeccak256 must be a lowercase hash");
  }
  if (!["unverified", "verified"].includes(record.verificationStatus)) {
    throw new Error("verificationStatus must be unverified or verified");
  }
  return record;
}

function buildDeploymentRecord(values) {
  const network = getNetwork(values.network);
  return validateDeploymentRecord({
    schemaVersion: 1,
    networkName: network.networkName,
    chainId: network.chainId,
    rpcOrigin: new URL(network.defaultRpcUrl).origin,
    explorerUrl: network.explorerUrl,
    faucetUrl: network.faucetUrl || null,
    contractName: FROZEN_CONTRACT.contractName,
    contractAddress: getAddress(values.contractAddress),
    deployerAddress: getAddress(values.deployerAddress),
    deploymentTransactionHash: values.deploymentTransactionHash,
    deploymentBlockNumber: values.deploymentBlockNumber,
    deploymentTimestampUtc: values.deploymentTimestampUtc,
    compilerVersion: FROZEN_CONTRACT.compilerVersion,
    compilerLongVersion: FROZEN_CONTRACT.compilerLongVersion,
    evmVersion: FROZEN_CONTRACT.evmVersion,
    optimizerEnabled: FROZEN_CONTRACT.optimizerEnabled,
    optimizerRuns: FROZEN_CONTRACT.optimizerRuns,
    constructorArguments: [],
    creationBytecodeSize: FROZEN_CONTRACT.creationBytecodeSize,
    runtimeBytecodeSize: FROZEN_CONTRACT.runtimeBytecodeSize,
    creationBytecodeKeccak256: FROZEN_CONTRACT.creationBytecodeKeccak256,
    runtimeBytecodeKeccak256: values.runtimeBytecodeKeccak256,
    standardInputSha256: FROZEN_CONTRACT.standardInputSha256,
    sourceCommit: values.sourceCommit,
    verificationStatus: values.verificationStatus || "unverified",
  });
}

function validateSelectedDeploymentRecord(
  record,
  { expectedChainId, recordPath }
) {
  const validated = validateDeploymentRecord(record);
  const expectedNetwork = getNetwork(expectedChainId);
  if (
    validated.chainId !== expectedNetwork.chainId ||
    validated.networkName !== expectedNetwork.networkName ||
    path.basename(recordPath) !== `${expectedNetwork.chainId}.json` ||
    path.basename(path.dirname(recordPath)) !== "deployments"
  ) {
    throw new Error(
      `Deployment record at ${recordPath} must match selected chain ${expectedNetwork.chainId} and network ${expectedNetwork.networkName}`
    );
  }
  return validated;
}

async function writeDeploymentRecordAtomic(record, outputPath, { fsApi = fsp } = {}) {
  validateDeploymentRecord(record);
  await fsApi.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fsApi.open(temporaryPath, "wx", 0o644);
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fsApi.link(temporaryPath, outputPath);
    await fsApi.unlink(temporaryPath);
  } catch (error) {
    await handle?.close();
    await fsApi.rm(temporaryPath, { force: true });
    if (error.code === "EEXIST") {
      throw new Error(`Deployment record already exists at ${outputPath}`);
    }
    throw error;
  }
  return outputPath;
}

function requireRawChainId(value, expectedChainId) {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value) ||
    BigInt(value) !== BigInt(expectedChainId)
  ) {
    throw new Error(
      `Raw remote eth_chainId must equal ${expectedChainId}`
    );
  }
  return value;
}

function requirePositiveEstimate(value) {
  let estimate;
  try {
    estimate = BigInt(value);
  } catch {
    throw new Error("Gas estimate is malformed");
  }
  if (estimate <= 0n) {
    throw new Error("Gas estimate must be greater than zero");
  }
  return estimate;
}

async function inspectLiveDeployment({ provider, network, frozen }) {
  const normalizedNetwork = getNetwork(network);
  const rawChainId = requireRawChainId(
    await provider.send("eth_chainId", []),
    normalizedNetwork.chainId
  );
  assertFrozenArtifact(frozen.artifact, frozen.buildInfo);
  const intendedDeployer = getAddress(normalizedNetwork.intendedDeployer);
  const factory = new ContractFactory(frozen.artifact.abi, frozen.artifact.bytecode);
  const deploymentRequest = await factory.getDeployTransaction();
  const [balance, nonce] = await Promise.all([
    provider.getBalance(intendedDeployer),
    provider.getTransactionCount(intendedDeployer, "pending"),
  ]);
  const estimatedGas = requirePositiveEstimate(
    await provider.estimateGas({ ...deploymentRequest, from: intendedDeployer })
  );
  const feeData = await provider.getFeeData();
  const maximumFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (typeof maximumFeePerGas !== "bigint" || maximumFeePerGas <= 0n) {
    throw new Error("Unable to determine a positive maximum fee per gas");
  }
  const maximumExpectedCost = estimatedGas * maximumFeePerGas;
  const requiredBalance = (maximumExpectedCost * 125n + 99n) / 100n;
  return {
    rawChainId,
    networkName: normalizedNetwork.networkName,
    chainId: normalizedNetwork.chainId,
    intendedDeployer,
    pendingNonce: nonce,
    predictedContractAddress: getCreateAddress({ from: intendedDeployer, nonce }),
    balanceWei: balance.toString(),
    balanceBot: formatEther(balance),
    estimatedGas: estimatedGas.toString(),
    gasCap: MAX_DEPLOY_GAS.toString(),
    maximumFeePerGasWei: maximumFeePerGas.toString(),
    maximumFeePerGasGwei: formatUnits(maximumFeePerGas, "gwei"),
    maximumExpectedCostWei: maximumExpectedCost.toString(),
    maximumExpectedCostBot: formatEther(maximumExpectedCost),
    requiredBalanceWei: requiredBalance.toString(),
    requiredBalanceBot: formatEther(requiredBalance),
    mainnetBudgetWei: MAINNET_DEPLOY_BUDGET.toString(),
    mainnetBudgetBot: formatEther(MAINNET_DEPLOY_BUDGET),
    withinGasCap: estimatedGas <= MAX_DEPLOY_GAS,
    withinMainnetBudget:
      normalizedNetwork.chainId !== BOTCHAIN_MAINNET.chainId ||
      requiredBalance <= MAINNET_DEPLOY_BUDGET,
    balanceSufficient: balance >= requiredBalance,
    transactionSent: false,
  };
}

async function executeDeployment({
  provider,
  network,
  frozen,
  signerFactory,
  confirm,
  sourceCommit,
  outputPath,
  writeRecord = writeDeploymentRecordAtomic,
  log = console.log,
}) {
  const normalizedNetwork = getNetwork(network);
  const rawChainId = requireRawChainId(
    await provider.send("eth_chainId", []),
    normalizedNetwork.chainId
  );
  assertFrozenArtifact(frozen.artifact, frozen.buildInfo);

  const intendedDeployer = getAddress(normalizedNetwork.intendedDeployer);
  const balance = await provider.getBalance(intendedDeployer);
  const factory = new ContractFactory(
    frozen.artifact.abi,
    frozen.artifact.bytecode
  );
  const deploymentRequest = await factory.getDeployTransaction();
  const nonce = await provider.getTransactionCount(
    intendedDeployer,
    "pending"
  );
  const predictedAddress = getCreateAddress({
    from: intendedDeployer,
    nonce,
  });

  let estimatedGas;
  try {
    estimatedGas = requirePositiveEstimate(
      await provider.estimateGas({
        ...deploymentRequest,
        from: intendedDeployer,
      })
    );
  } catch (error) {
    if (error.message.includes("Gas estimate")) {
      throw error;
    }
    throw new Error("Gas estimation failed");
  }
  if (estimatedGas > MAX_DEPLOY_GAS) {
    throw new Error(
      `Estimated deployment gas ${estimatedGas} exceeds the reviewed cap ${MAX_DEPLOY_GAS}`
    );
  }

  const feeData = await provider.getFeeData();
  const maximumFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (typeof maximumFeePerGas !== "bigint" || maximumFeePerGas <= 0n) {
    throw new Error("Unable to determine a positive maximum fee per gas");
  }
  const maximumExpectedCost = estimatedGas * maximumFeePerGas;
  const requiredBalance = (maximumExpectedCost * 125n + 99n) / 100n;
  if (
    normalizedNetwork.chainId === BOTCHAIN_MAINNET.chainId &&
    requiredBalance > MAINNET_DEPLOY_BUDGET
  ) {
    throw new Error(
      "Mainnet maximum deployment cost plus the 25% safety buffer exceeds the 0.0389 BOT budget"
    );
  }
  if (balance < requiredBalance) {
    throw new Error(
      "Deployer balance is insufficient for maximum cost plus the 25% safety buffer"
    );
  }

  log(`Raw remote eth_chainId: ${rawChainId}`);
  log(`Intended deployer: ${intendedDeployer}`);
  log(`Deployer balance: ${formatEther(balance)} BOT`);
  log(`Estimated gas: ${estimatedGas}`);
  log(`Maximum fee per gas: ${formatUnits(maximumFeePerGas, "gwei")} gwei`);
  log(`Maximum expected cost: ${formatEther(maximumExpectedCost)} BOT`);
  log(`Required balance with 25% buffer: ${formatEther(requiredBalance)} BOT`);
  log(`Predicted contract address: ${predictedAddress}`);

  if (!(await confirm(CONFIRMATION_PHRASES[normalizedNetwork.chainId]))) {
    throw new Error("Deployment authorization declined");
  }

  const signer = await signerFactory();
  const signerAddress = getAddress(await signer.getAddress());
  if (signerAddress !== intendedDeployer) {
    throw new Error(`Signer must equal intended deployer ${intendedDeployer}`);
  }

  requireRawChainId(
    await provider.send("eth_chainId", []),
    normalizedNetwork.chainId
  );
  const refreshedNonce = await provider.getTransactionCount(
    intendedDeployer,
    "pending"
  );
  if (refreshedNonce !== nonce) {
    throw new Error(
      `Deployment pending nonce changed during confirmation (${nonce} to ${refreshedNonce}); rerun inspection and authorization`
    );
  }
  const refreshedBalance = await provider.getBalance(intendedDeployer);
  const refreshedEstimate = requirePositiveEstimate(
    await provider.estimateGas({
      ...deploymentRequest,
      from: intendedDeployer,
    })
  );
  const refreshedFeeData = await provider.getFeeData();
  const refreshedMaximumFeePerGas =
    refreshedFeeData.maxFeePerGas ?? refreshedFeeData.gasPrice;
  if (
    refreshedBalance !== balance ||
    refreshedEstimate !== estimatedGas ||
    refreshedMaximumFeePerGas !== maximumFeePerGas ||
    refreshedFeeData.maxPriorityFeePerGas !== feeData.maxPriorityFeePerGas
  ) {
    throw new Error(
      "Deployment balance, gas, or fee preflight changed during confirmation; rerun to review the updated values"
    );
  }

  const feeOverrides =
    feeData.maxFeePerGas != null
      ? {
          maxFeePerGas: feeData.maxFeePerGas,
          ...(feeData.maxPriorityFeePerGas != null
            ? { maxPriorityFeePerGas: feeData.maxPriorityFeePerGas }
            : {}),
        }
      : { gasPrice: feeData.gasPrice };
  const transaction = await signer.sendTransaction({
    ...deploymentRequest,
    nonce,
    gasLimit: estimatedGas,
    ...feeOverrides,
  });
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error("Deployment receipt did not report status 1");
  }

  const contractAddress = getAddress(
    receipt.contractAddress || predictedAddress
  );
  if (contractAddress !== predictedAddress) {
    throw new Error("Receipt contract address differs from the prediction");
  }
  const runtimeCode = await provider.getCode(
    contractAddress,
    receipt.blockNumber
  );
  const runtimeValidation = validateDeployedRuntime({
    runtimeCode,
    artifact: frozen.artifact,
    immutableReferences: frozen.immutableReferences,
    chainId: normalizedNetwork.chainId,
    contractAddress,
  });
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block) {
    throw new Error("Deployment block could not be read");
  }

  const record = buildDeploymentRecord({
    network: normalizedNetwork,
    contractAddress,
    deployerAddress: signerAddress,
    deploymentTransactionHash: transaction.hash,
    deploymentBlockNumber: receipt.blockNumber,
    deploymentTimestampUtc: new Date(block.timestamp * 1000).toISOString(),
    runtimeBytecodeKeccak256:
      runtimeValidation.runtimeBytecodeKeccak256,
    sourceCommit,
  });
  await writeRecord(record, outputPath);
  return {
    record,
    estimatedGas,
    maximumExpectedCost,
    requiredBalance,
    predictedAddress,
    immutableValues: runtimeValidation.immutableValues,
  };
}

async function assertTargetAbsent(outputPath, { fsApi = fsp } = {}) {
  try {
    await fsApi.lstat(outputPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`Deployment record already exists at ${outputPath}`);
}

async function acquireLock(outputPath, { fsApi = fsp } = {}) {
  await fsApi.mkdir(path.dirname(outputPath), { recursive: true });
  const lockPath = `${outputPath}.lock`;
  let handle;
  try {
    handle = await fsApi.open(lockPath, "wx", 0o644);
    await handle.close();
    handle = null;
  } catch (error) {
    await handle?.close();
    if (error.code === "EEXIST") {
      throw new Error(
        `Deployment lock already exists at ${lockPath}; investigate before retrying`
      );
    }
    throw error;
  }
  try {
    await assertTargetAbsent(outputPath, { fsApi });
  } catch (error) {
    await fsApi.unlink(lockPath);
    throw error;
  }
  return lockPath;
}

function inspectionSummary(network, frozen) {
  const normalizedNetwork = getNetwork(network);
  return {
    mode: "inspect",
    schemaVersion: 1,
    networkName: normalizedNetwork.networkName,
    chainId: normalizedNetwork.chainId,
    rpcUrl: normalizedNetwork.defaultRpcUrl,
    explorerUrl: normalizedNetwork.explorerUrl,
    intendedDeployer: normalizedNetwork.intendedDeployer,
    outputPath: `deployments/${normalizedNetwork.chainId}.json`,
    contractAddress: null,
    confirmationPhrase:
      CONFIRMATION_PHRASES[normalizedNetwork.chainId],
    maxDeployGas: MAX_DEPLOY_GAS.toString(),
    mainnetDeployBudgetBot: formatEther(MAINNET_DEPLOY_BUDGET),
    frozenArtifact: FROZEN_CONTRACT,
    immutableReferences: frozen.immutableReferences,
  };
}

async function runDeploymentCommand({
  mode,
  network,
  projectRoot,
  outputPath = deploymentPath(projectRoot, network.chainId),
  fsApi = fsp,
  loadArtifact = loadFrozenArtifact,
  createProvider,
  createSigner,
  confirm,
  assertClean = assertTrackedSourceClean,
  sourceCommit = getSourceCommit,
  executeDeployment: deploy = executeDeployment,
  log = console.log,
}) {
  if (!["--inspect", "--authorize"].includes(mode)) {
    throw new Error("Use exactly --inspect or --authorize");
  }
  const normalizedNetwork = getNetwork(network);
  const frozen = loadArtifact(projectRoot);
  const summary = inspectionSummary(normalizedNetwork, frozen);
  log(JSON.stringify(summary, null, 2));
  if (mode === "--inspect") {
    log("Inspection complete: no provider, signer, lock, or transaction was created.");
    return summary;
  }

  await assertTargetAbsent(outputPath, { fsApi });
  assertClean(`BOTPass ${normalizedNetwork.networkName}`, projectRoot);
  const lockPath = await acquireLock(outputPath, { fsApi });
  let provider;
  try {
    provider = createProvider(normalizedNetwork);
    return await deploy({
      provider,
      network: normalizedNetwork,
      frozen,
      signerFactory: async () => createSigner(provider, normalizedNetwork),
      confirm,
      sourceCommit: sourceCommit(projectRoot),
      outputPath,
      log,
    });
  } finally {
    provider?.destroy?.();
    await fsApi.unlink(lockPath);
  }
}

module.exports = {
  CONFIRMATION_PHRASES,
  FROZEN_CONTRACT,
  MAINNET_DEPLOY_BUDGET,
  MAX_DEPLOY_GAS,
  RECORD_FIELDS,
  acquireLock,
  assertFrozenArtifact,
  buildDeploymentRecord,
  deploymentPath,
  deriveImmutableReferences,
  executeDeployment,
  expectedImmutableValues,
  getNetwork,
  inspectionSummary,
  inspectLiveDeployment,
  loadFrozenArtifact,
  materializeExpectedRuntime,
  requirePositiveEstimate,
  requireRawChainId,
  runDeploymentCommand,
  validateDeployedRuntime,
  validateSelectedDeploymentRecord,
  validateDeploymentRecord,
  writeDeploymentRecordAtomic,
};
