"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { expect } = require("chai");

const projectRoot = path.resolve(__dirname, "..");
const importModule = (relativePath) =>
  import(pathToFileURL(path.join(projectRoot, relativePath)).href);

function event(organizer, name = "Event") {
  return {
    organizer,
    name,
    description: "Description",
    location: "Makassar",
    startTime: 1_800_000_000n,
    endTime: 1_800_003_600n,
    claimOpen: true,
    passCount: 2n,
  };
}

describe("BOTPass frontend application services", function () {
  it("reads the canonical getEvent signature without NFT fields", async function () {
    const { readEventFromContract } = await importModule("frontend/src/contract.js");
    const calls = [];
    const contract = {
      "getEvent(uint256)": async (id) => {
        calls.push(id);
        return event("0x1111111111111111111111111111111111111111");
      },
    };
    const result = await readEventFromContract(contract, 7n);
    expect(calls).to.deep.equal([7n]);
    expect(result).to.include({ id: 7n, name: "Event", passCount: 2n });
    expect(result).not.to.have.any.keys("claimMode", "tokenId", "tokenURI");
  });

  it("scans newest-first and caps all public discovery at 100 events", async function () {
    const { readLatestEventIdsFromContract } = await importModule("frontend/src/contract.js");
    expect(await readLatestEventIdsFromContract({ eventCount: async () => 105n })).to.deep.equal(
      Array.from({ length: 100 }, (_, index) => 105n - BigInt(index))
    );
  });

  it("limits concurrent public event RPC reads", async function () {
    const { PUBLIC_RPC_CONCURRENCY, readLatestEventsFromContract } = await importModule("frontend/src/contract.js");
    let active = 0;
    let peak = 0;
    const contract = {
      eventCount: async () => 20n,
      "getEvent(uint256)": async (id) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return event("0x1111111111111111111111111111111111111111", `Event ${id}`);
      },
    };
    expect(await readLatestEventsFromContract(contract)).to.have.length(20);
    expect(peak).to.be.at.most(PUBLIC_RPC_CONCURRENCY);
  });

  it("derives organizer events by filtering the latest event records", async function () {
    const { readOrganizerEventsFromContract } = await importModule("frontend/src/contract.js");
    const organizer = "0x1111111111111111111111111111111111111111";
    const other = "0x2222222222222222222222222222222222222222";
    const contract = {
      eventCount: async () => 3n,
      "getEvent(uint256)": async (id) => event(id === 2n ? organizer : other, `Event ${id}`),
    };
    const result = await readOrganizerEventsFromContract(contract, organizer);
    expect(result.map(({ id }) => id)).to.deep.equal([2n]);
  });

  it("derives My Passes from claimedAt without token indexes", async function () {
    const { readWalletPassesFromContract } = await importModule("frontend/src/contract.js");
    const attendee = "0x3333333333333333333333333333333333333333";
    const contract = {
      eventCount: async () => 3n,
      claimedAt: async (id) => (id === 2n ? 1_800_000_010n : 0n),
      "getEvent(uint256)": async (id) => event("0x1111111111111111111111111111111111111111", `Event ${id}`),
    };
    const result = await readWalletPassesFromContract(contract, attendee);
    expect(result).to.deep.equal([{ eventId: 2n, claimedAt: 1_800_000_010n, attendee, event: { id: 2n, ...event("0x1111111111111111111111111111111111111111", "Event 2") } }]);
  });

  it("keeps wallet switching EIP-1193-compatible", async function () {
    const { switchOrAddBotChain } = await importModule("frontend/src/wallet.js");
    const calls = [];
    const provider = {
      request: async ({ method }) => {
        calls.push(method);
        if (method === "wallet_switchEthereumChain" && calls.length === 1) {
          const error = new Error("unknown chain");
          error.code = 4902;
          throw error;
        }
        if (method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_chainId") return "0x3c8";
        return null;
      },
    };
    const snapshot = await switchOrAddBotChain({ provider });
    expect(snapshot.chainId).to.equal(968);
    expect(calls).to.include("wallet_addEthereumChain");
  });
});
