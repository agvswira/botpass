"use strict";

const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  assertLocalIntegrationResult,
  runLocalIntegration,
} = require("../scripts/lib/local-integration");

describe("BOTPass local integration", function () {
  function completeResult() {
    return {
      contractAddress: "0x1111111111111111111111111111111111111111",
      chainId: "31337",
      eventCount: "2",
      organizerOneEventId: "1",
      organizerTwoEventId: "2",
      eventOnePassCount: "2",
      eventTwoPassCount: "1",
      attendeeOneClaimedAt: "1800000000",
      attendeeTwoClaimedAt: "1800000001",
      attendeeThreeClaimedAt: "1800000002",
      duplicateRejected: true,
      closedClaimRejected: true,
      verified: true,
    };
  }

  it("asserts every advertised Open Claim invariant", function () {
    const valid = completeResult();
    expect(assertLocalIntegrationResult(valid)).to.equal(valid);
    for (const [path, mutate] of [
      ["contractAddress", (value) => (value.contractAddress = ethers.ZeroAddress)],
      ["chainId", (value) => (value.chainId = "968")],
      ["eventCount", (value) => (value.eventCount = "1")],
      ["eventOnePassCount", (value) => (value.eventOnePassCount = "1")],
      ["duplicateRejected", (value) => (value.duplicateRejected = false)],
      ["closedClaimRejected", (value) => (value.closedClaimRejected = false)],
      ["verified", (value) => (value.verified = false)],
    ]) {
      const invalid = structuredClone(valid);
      mutate(invalid);
      expect(() => assertLocalIntegrationResult(invalid), path).to.throw(path);
    }
  });

  it("refuses a non-Hardhat chain before requesting signers", async function () {
    let signerRequested = false;
    await expect(
      runLocalIntegration({
        ethers: {
          provider: { getNetwork: async () => ({ chainId: 968n }) },
          getSigners: async () => {
            signerRequested = true;
          },
        },
      })
    ).to.be.rejectedWith("requires Hardhat Chain ID 31337");
    expect(signerRequested).to.equal(false);
  });

  it("runs multi-organizer Open Claim against one fresh deployment", async function () {
    const result = await runLocalIntegration({ ethers });
    expect(result).to.include({
      chainId: "31337",
      eventCount: "2",
      organizerOneEventId: "1",
      organizerTwoEventId: "2",
      eventOnePassCount: "2",
      eventTwoPassCount: "1",
      duplicateRejected: true,
      closedClaimRejected: true,
      verified: true,
    });
    expect(BigInt(result.attendeeOneClaimedAt)).to.be.greaterThan(0n);
    expect(BigInt(result.attendeeTwoClaimedAt)).to.be.greaterThan(0n);
    expect(BigInt(result.attendeeThreeClaimedAt)).to.be.greaterThan(0n);
  });
});
