"use strict";

const { getAddress } = require("ethers");

const TESTNET_EVENT_CONFIRMATION = "CREATE AND OPEN ONE BOTPASS TESTNET EVENT";

function buildTestnetDemoEvent(chainTimestamp) {
  if (!Number.isSafeInteger(chainTimestamp) || chainTimestamp < 1) {
    throw new Error("A safe positive Testnet chain timestamp is required");
  }
  return Object.freeze({
    name: "BOTPass Open Claim Demo",
    description: "Functional Open Claim acceptance event on BOT Chain Testnet.",
    location: "BOT Chain Testnet",
    startTime: chainTimestamp + 60,
    endTime: chainTimestamp + 86_400,
  });
}

function eventArguments(event) {
  return [event.name, event.description, event.location, event.startTime, event.endTime];
}

async function executeTestnetDemo({
  provider,
  contract,
  organizer,
  confirm,
  log = console.log,
}) {
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 968) throw new Error("Demo event writes are Testnet-only (Chain ID 968)");
  const organizerAddress = getAddress(await organizer.getAddress());
  const latest = await provider.getBlock("latest");
  if (!latest) throw new Error("Latest Testnet block is unavailable");
  const event = buildTestnetDemoEvent(latest.timestamp);
  const count = await contract.eventCount();
  let eventId = count + 1n;
  let resumed = false;
  if (count > 0n) {
    const previous = await contract["getEvent(uint256)"](count);
    const matchesDemo =
      previous.organizer === organizerAddress &&
      previous.name === event.name &&
      previous.description === event.description &&
      previous.location === event.location &&
      BigInt(previous.endTime) > BigInt(latest.timestamp);
    if (matchesDemo) {
      eventId = count;
      resumed = true;
      if (previous.claimOpen) {
        return {
          eventId: eventId.toString(),
          organizer: organizerAddress,
          creationTransactionHash: null,
          openTransactionHash: null,
          resumed: true,
          alreadyComplete: true,
          claimOpen: true,
        };
      }
    }
  }
  log(JSON.stringify({ chainId: 968, organizer: organizerAddress, eventId: eventId.toString(), action: resumed ? "open-existing" : "create-and-open", event }, null, 2));
  if (!(await confirm(TESTNET_EVENT_CONFIRMATION))) throw new Error("Testnet demo authorization declined");

  let creation = null;
  if (!resumed) {
    creation = await contract.createEvent(...eventArguments(event));
    const creationReceipt = await creation.wait(1);
    if (!creationReceipt || creationReceipt.status !== 1) throw new Error("Testnet event creation failed");
    const stored = await contract["getEvent(uint256)"](
      eventId,
      { blockTag: creationReceipt.blockNumber }
    );
    if (stored.organizer !== organizerAddress || stored.claimOpen !== false) throw new Error("Created Testnet event state does not match the plan");
  }

  const opening = await contract.setClaimOpen(eventId, true);
  const openingReceipt = await opening.wait(1);
  if (!openingReceipt || openingReceipt.status !== 1) throw new Error("Opening Testnet claims failed");
  const opened = await contract["getEvent(uint256)"](
    eventId,
    { blockTag: openingReceipt.blockNumber }
  );
  if (opened.claimOpen !== true) throw new Error("Testnet event did not become claimable");
  return {
    eventId: eventId.toString(),
    organizer: organizerAddress,
    creationTransactionHash: creation?.hash ?? null,
    openTransactionHash: opening.hash,
    resumed,
    claimOpen: true,
  };
}

module.exports = {
  TESTNET_EVENT_CONFIRMATION,
  buildTestnetDemoEvent,
  eventArguments,
  executeTestnetDemo,
};
