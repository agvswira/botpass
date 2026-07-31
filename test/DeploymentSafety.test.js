"use strict";

const path = require("node:path");
const { expect } = require("chai");
const {
  getAddress,
  getCreateAddress,
  keccak256,
  parseEther,
} = require("ethers");
const { BOTCHAIN_MAINNET, BOTCHAIN_TESTNET } = require("../config/botchain");
const {
  CONFIRMATION_PHRASES,
  FROZEN_CONTRACT,
  MAINNET_DEPLOY_BUDGET,
  MAX_DEPLOY_GAS,
  buildDeploymentRecord,
  executeDeployment,
  inspectionSummary,
  inspectLiveDeployment,
  loadFrozenArtifact,
  materializeExpectedRuntime,
  validateDeployedRuntime,
  validateDeploymentRecord,
} = require("../scripts/lib/deployment");
const {
  TESTNET_EVENT_CONFIRMATION,
  buildTestnetDemoEvent,
  executeTestnetDemo,
} = require("../scripts/lib/demo-events");
const { createSigner } = require("../scripts/deploy");
const { withProvider } = require("../scripts/demo-events");
const { blockingSourceChanges } = require("../scripts/lib/project");

describe("BOTPass deployment safety", function () {
  const projectRoot = path.resolve(__dirname, "..");
  const sourceCommit = "a".repeat(40);
  const transactionHash = `0x${"11".repeat(32)}`;
  let frozen;

  before(function () {
    frozen = loadFrozenArtifact(projectRoot);
  });

  it("permits only the two protected local reference documents", function () {
    expect(
      blockingSourceChanges(
        "?? docs/bot-chain-developer-documentation.md\n" +
          "?? docs/hackathon-guidebook-botchain-build-week.md"
      )
    ).to.deep.equal([]);
    expect(blockingSourceChanges(" M contracts/BOTPass.sol")).to.deep.equal([
      " M contracts/BOTPass.sol",
    ]);
  });

  function harness({
    network = BOTCHAIN_TESTNET,
    estimatedGas = 835_162n,
    maximumFeePerGas = 20_000_000_000n,
    balance = parseEther("1"),
    confirmed = true,
    signerAddress,
  } = {}) {
    const intended = getAddress(network.intendedDeployer);
    const predicted = getCreateAddress({ from: intended, nonce: 0 });
    const state = { confirmations: 0, signerCreations: 0, sends: 0, writes: 0 };
    const provider = {
      send: async () => `0x${network.chainId.toString(16)}`,
      getBalance: async () => balance,
      getTransactionCount: async () => 0,
      estimateGas: async () => estimatedGas,
      getFeeData: async () => ({
        maxFeePerGas: maximumFeePerGas,
        maxPriorityFeePerGas: 1_000_000_000n,
        gasPrice: null,
      }),
      getCode: async () => frozen.artifact.deployedBytecode,
      getBlock: async () => ({ timestamp: 1_785_469_323 }),
    };
    const signer = {
      getAddress: async () => signerAddress || intended,
      sendTransaction: async () => {
        state.sends += 1;
        return {
          hash: transactionHash,
          wait: async () => ({
            status: 1,
            contractAddress: predicted,
            blockNumber: 123,
          }),
        };
      },
    };
    return {
      state,
      options: {
        provider,
        network,
        frozen,
        sourceCommit,
        outputPath: `/unused/deployments/${network.chainId}.json`,
        signerFactory: async () => {
          state.signerCreations += 1;
          return signer;
        },
        confirm: async (phrase) => {
          state.confirmations += 1;
          expect(phrase).to.equal(CONFIRMATION_PHRASES[network.chainId]);
          return confirmed;
        },
        writeRecord: async () => {
          state.writes += 1;
        },
        log: () => {},
      },
    };
  }

  async function expectRejection(promise, fragment) {
    let caught;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(Error);
    expect(caught.message).to.include(fragment);
  }

  it("freezes only the standalone compact registry", function () {
    expect(frozen.buildInfo.input.sources).to.have.all.keys(
      "contracts/BOTPass.sol"
    );
    expect(frozen.immutableReferences).to.deep.equal([]);
    expect(FROZEN_CONTRACT.creationBytecodeSize).to.equal(3652);
    expect(FROZEN_CONTRACT.runtimeBytecodeSize).to.equal(3620);
    expect(FROZEN_CONTRACT.runtimeBytecodeSize).to.be.lessThan(4096);
  });

  it("pins the reviewed Mainnet gas and BOT budget", function () {
    expect(MAX_DEPLOY_GAS).to.equal(1_400_000n);
    expect(MAINNET_DEPLOY_BUDGET).to.equal(parseEther("0.0389"));
    expect(inspectionSummary(BOTCHAIN_MAINNET, frozen)).to.include({
      maxDeployGas: "1400000",
      mainnetDeployBudgetBot: "0.0389",
    });
  });

  it("provides a signer-free live Mainnet fee and balance preflight", async function () {
    const test = harness({
      network: BOTCHAIN_MAINNET,
      balance: MAINNET_DEPLOY_BUDGET,
    });
    const result = await inspectLiveDeployment({
      provider: test.options.provider,
      network: BOTCHAIN_MAINNET,
      frozen,
    });
    expect(result).to.include({
      chainId: 677,
      estimatedGas: "835162",
      maximumFeePerGasWei: "20000000000",
      balanceBot: "0.0389",
      withinGasCap: true,
      withinMainnetBudget: true,
      balanceSufficient: true,
    });
    expect(result.requiredBalanceWei).to.equal("20879050000000000");
  });

  it("accepts the existing unprefixed Testnet key variable without exposing it", function () {
    const previous = process.env.BOTCHAIN_TESTNET_DEPLOYER_PRIVATE_KEY;
    const previousPreferred = process.env.BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY;
    delete process.env.BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY;
    process.env.BOTCHAIN_TESTNET_DEPLOYER_PRIVATE_KEY = "01".repeat(32);
    try {
      expect(createSigner(null, BOTCHAIN_TESTNET).address).to.match(/^0x[0-9a-fA-F]{40}$/);
    } finally {
      if (previous === undefined) delete process.env.BOTCHAIN_TESTNET_DEPLOYER_PRIVATE_KEY;
      else process.env.BOTCHAIN_TESTNET_DEPLOYER_PRIVATE_KEY = previous;
      if (previousPreferred === undefined) delete process.env.BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY;
      else process.env.BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY = previousPreferred;
    }
  });

  it("records a no-constructor deployment with exact bytecode metadata", function () {
    const record = buildDeploymentRecord({
      network: BOTCHAIN_MAINNET,
      contractAddress: "0x1111111111111111111111111111111111111111",
      deployerAddress: BOTCHAIN_MAINNET.intendedDeployer,
      deploymentTransactionHash: transactionHash,
      deploymentBlockNumber: 123,
      deploymentTimestampUtc: "2026-07-31T01:02:03.000Z",
      sourceCommit,
      runtimeBytecodeKeccak256: FROZEN_CONTRACT.runtimeTemplateKeccak256,
    });

    expect(record.constructorArguments).to.deep.equal([]);
    expect(record.creationBytecodeSize).to.equal(3652);
    expect(record.runtimeBytecodeSize).to.equal(3620);
    expect(validateDeploymentRecord(record)).to.equal(record);
    expect(() =>
      validateDeploymentRecord({ ...record, privateKey: "forbidden" })
    ).to.throw("unexpected: privateKey");
  });

  it("validates exact runtime without address- or chain-specific immutables", function () {
    const runtime = materializeExpectedRuntime({
      artifact: frozen.artifact,
      immutableReferences: frozen.immutableReferences,
      chainId: BOTCHAIN_MAINNET.chainId,
      contractAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(runtime).to.equal(frozen.artifact.deployedBytecode);
    expect(
      validateDeployedRuntime({
        runtimeCode: runtime,
        artifact: frozen.artifact,
        immutableReferences: [],
        chainId: BOTCHAIN_MAINNET.chainId,
        contractAddress: "0x1111111111111111111111111111111111111111",
      })
    ).to.deep.equal({
      runtimeBytecodeKeccak256: keccak256(runtime),
      immutableValues: {},
    });
  });

  it("rejects a deployment estimate above the reviewed gas ceiling", async function () {
    const test = harness({ estimatedGas: MAX_DEPLOY_GAS + 1n });
    await expectRejection(
      executeDeployment(test.options),
      "exceeds the reviewed cap"
    );
    expect(test.state.confirmations).to.equal(0);
    expect(test.state.sends).to.equal(0);
  });

  it("rejects Mainnet when maximum cost plus buffer exceeds 0.0389 BOT", async function () {
    const test = harness({
      network: BOTCHAIN_MAINNET,
      estimatedGas: 1_000_000n,
      maximumFeePerGas: 40_000_000_000n,
      balance: parseEther("1"),
    });
    await expectRejection(
      executeDeployment(test.options),
      "exceeds the 0.0389 BOT budget"
    );
    expect(test.state.confirmations).to.equal(0);
  });

  it("requires sufficient wallet balance after the same 25 percent buffer", async function () {
    const test = harness({ balance: 1n });
    await expectRejection(
      executeDeployment(test.options),
      "balance is insufficient"
    );
    expect(test.state.signerCreations).to.equal(0);
  });

  it("requires the exact chain and reviewed deployer before sending", async function () {
    const wrongChain = harness();
    wrongChain.options.provider.send = async () => "0x2a5";
    await expectRejection(
      executeDeployment(wrongChain.options),
      "Raw remote eth_chainId"
    );

    const wrongSigner = harness({
      signerAddress: "0x2222222222222222222222222222222222222222",
    });
    await expectRejection(
      executeDeployment(wrongSigner.options),
      "Signer must equal intended deployer"
    );
    expect(wrongSigner.state.sends).to.equal(0);
  });

  it("deploys the exact functional bytecode when every guard passes", async function () {
    const test = harness({
      network: BOTCHAIN_MAINNET,
      balance: MAINNET_DEPLOY_BUDGET,
    });
    const result = await executeDeployment(test.options);

    expect(result.estimatedGas).to.equal(835_162n);
    expect(result.requiredBalance).to.be.at.most(MAINNET_DEPLOY_BUDGET);
    expect(result.immutableValues).to.deep.equal({});
    expect(test.state).to.deep.equal({
      confirmations: 1,
      signerCreations: 1,
      sends: 1,
      writes: 1,
    });
  });

  it("keeps demo writes Testnet-only and Open Claim-only", async function () {
    expect(buildTestnetDemoEvent(2_000_000_000)).to.deep.equal({
      name: "BOTPass Open Claim Demo",
      description: "Functional Open Claim acceptance event on BOT Chain Testnet.",
      location: "BOT Chain Testnet",
      startTime: 2_000_000_060,
      endTime: 2_000_086_400,
    });
    await expectRejection(
      executeTestnetDemo({
        provider: { getNetwork: async () => ({ chainId: 677n }) },
      }),
      "Testnet-only"
    );
  });

  it("creates then opens exactly one Testnet acceptance event", async function () {
    const organizer = "0xe604829a9c327b0d924718CfAcEF69BBdC8C0Efc";
    let open = false;
    const receipt = { status: 1 };
    const result = await executeTestnetDemo({
      provider: {
        getNetwork: async () => ({ chainId: 968n }),
        getBlock: async () => ({ timestamp: 2_000_000_000 }),
      },
      organizer: { getAddress: async () => organizer },
      contract: {
        eventCount: async () => 0n,
        createEvent: async (...args) => {
          expect(args).to.have.length(5);
          return { hash: transactionHash, wait: async () => receipt };
        },
        setClaimOpen: async (eventId, value) => {
          expect([eventId, value]).to.deep.equal([1n, true]);
          open = true;
          return { hash: `0x${"22".repeat(32)}`, wait: async () => receipt };
        },
        "getEvent(uint256)": async () => ({ organizer, claimOpen: open }),
      },
      confirm: async (phrase) => phrase === TESTNET_EVENT_CONFIRMATION,
      log: () => {},
    });
    expect(result).to.include({ eventId: "1", organizer, claimOpen: true });
  });

  it("keeps the Testnet provider alive until asynchronous setup settles", async function () {
    let destroyed = false;
    const value = await withProvider(
      { destroy: () => { destroyed = true; } },
      async () => {
        await Promise.resolve();
        expect(destroyed).to.equal(false);
        return "settled";
      }
    );
    expect(value).to.equal("settled");
    expect(destroyed).to.equal(true);
  });
});
