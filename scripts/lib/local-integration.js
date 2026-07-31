"use strict";

const assert = require("node:assert/strict");

async function waitFor(transactionPromise) {
  const transaction = await transactionPromise;
  const receipt = await transaction.wait();
  assert.equal(receipt.status, 1, `Transaction ${transaction.hash} failed`);
  return receipt;
}

function errorData(error) {
  return error?.data ?? error?.error?.data ?? error?.info?.error?.data ?? null;
}

async function expectCustomError(action, contract, expectedName) {
  try {
    await action();
  } catch (error) {
    const data = errorData(error);
    if (data && contract.interface.parseError(data)?.name === expectedName) return;
    if (error?.errorName === expectedName) return;
    throw error;
  }
  assert.fail(`Expected ${expectedName}`);
}

function assertLocalIntegrationResult(result) {
  assert.match(result.contractAddress, /^0x[0-9a-fA-F]{40}$/, "contractAddress");
  assert.notEqual(result.contractAddress.toLowerCase(), `0x${"0".repeat(40)}`, "contractAddress");
  for (const [path, actual, expected] of [
    ["chainId", result.chainId, "31337"],
    ["eventCount", result.eventCount, "2"],
    ["organizerOneEventId", result.organizerOneEventId, "1"],
    ["organizerTwoEventId", result.organizerTwoEventId, "2"],
    ["eventOnePassCount", result.eventOnePassCount, "2"],
    ["eventTwoPassCount", result.eventTwoPassCount, "1"],
    ["duplicateRejected", result.duplicateRejected, true],
    ["closedClaimRejected", result.closedClaimRejected, true],
    ["verified", result.verified, true],
  ]) assert.equal(actual, expected, path);
  for (const path of [
    "attendeeOneClaimedAt",
    "attendeeTwoClaimedAt",
    "attendeeThreeClaimedAt",
  ]) assert(BigInt(result[path]) > 0n, path);
  return result;
}

async function runLocalIntegration({ ethers }) {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 31_337n) {
    throw new Error(`BOTPass local integration requires Hardhat Chain ID 31337, received ${network.chainId}`);
  }
  const [organizerOne, organizerTwo, attendeeOne, attendeeTwo, attendeeThree] =
    await ethers.getSigners();
  const latest = await ethers.provider.getBlock("latest");
  const startTime = latest.timestamp + 60;
  const endTime = startTime + 3_600;
  const botPass = await (await ethers.getContractFactory("BOTPass", organizerOne)).deploy();
  await botPass.waitForDeployment();

  await waitFor(botPass.createEvent("Open One", "First organizer event", "Hardhat", startTime, endTime));
  await waitFor(botPass.connect(organizerTwo).createEvent("Open Two", "Second organizer event", "Hardhat", startTime, endTime));
  await waitFor(botPass.setClaimOpen(1, true));
  await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
  await waitFor(botPass.connect(attendeeOne).claimOpen(1));
  await waitFor(botPass.connect(attendeeTwo).claimOpen(1));
  await expectCustomError(() => botPass.connect(attendeeOne).claimOpen(1), botPass, "AlreadyClaimed");
  await expectCustomError(() => botPass.connect(attendeeThree).claimOpen(2), botPass, "ClaimClosed");
  await waitFor(botPass.connect(organizerTwo).setClaimOpen(2, true));
  await waitFor(botPass.connect(attendeeThree).claimOpen(2));

  const eventOne = await botPass["getEvent(uint256)"](1);
  const eventTwo = await botPass["getEvent(uint256)"](2);
  const result = {
    contractAddress: await botPass.getAddress(),
    chainId: network.chainId.toString(),
    eventCount: (await botPass.eventCount()).toString(),
    organizerOneEventId: eventOne.organizer === organizerOne.address ? "1" : "0",
    organizerTwoEventId: eventTwo.organizer === organizerTwo.address ? "2" : "0",
    eventOnePassCount: eventOne.passCount.toString(),
    eventTwoPassCount: eventTwo.passCount.toString(),
    attendeeOneClaimedAt: (await botPass.claimedAt(1, attendeeOne.address)).toString(),
    attendeeTwoClaimedAt: (await botPass.claimedAt(1, attendeeTwo.address)).toString(),
    attendeeThreeClaimedAt: (await botPass.claimedAt(2, attendeeThree.address)).toString(),
    duplicateRejected: true,
    closedClaimRejected: true,
    verified: true,
  };
  return assertLocalIntegrationResult(result);
}

module.exports = { assertLocalIntegrationResult, runLocalIntegration };
