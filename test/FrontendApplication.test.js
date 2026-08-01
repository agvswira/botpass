"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { expect } = require("chai");

const projectRoot = path.resolve(__dirname, "..");
const importModule = (relativePath) =>
  import(pathToFileURL(path.join(projectRoot, relativePath)).href);

class TestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }
}

function descendants(node, tagName) {
  return node.children.flatMap((child) => [
    ...(child.tagName === tagName ? [child] : []),
    ...descendants(child, tagName),
  ]);
}

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
  it("renders loading and error states as list items only for event lists", async function () {
    const { setListState } = await importModule("frontend/src/pass/controller.mjs");
    const eventList = new TestElement("UL");
    const eventErrorList = new TestElement("UL");
    const passContainer = new TestElement("DIV");
    const previousDocument = global.document;
    global.document = { createElement: (tagName) => new TestElement(tagName) };
    try {
      setListState(eventList, "loading", "Loading events…");
      setListState(eventErrorList, "error", "Events could not be loaded");
      setListState(passContainer, "error", "Passes could not be loaded");

      expect(eventList.children[0].tagName).to.equal("li");
      expect(eventList.children[0].attributes.role).to.equal("status");
      expect(eventList.attributes["aria-busy"]).to.equal("true");
      expect(eventErrorList.children[0].tagName).to.equal("li");
      expect(eventErrorList.children[0].attributes.role).to.equal("alert");
      expect(passContainer.children[0].tagName).to.equal("div");
      expect(passContainer.children[0].attributes.role).to.equal("alert");
    } finally {
      global.document = previousDocument;
    }
  });

  it("keeps event routes as semantic lists with an anchored page shell", function () {
    const html = fs.readFileSync(path.join(projectRoot, "frontend/index.html"), "utf8");
    expect(html).to.match(/<ul\s+id="home-events"\s+class="event-list"[^>]*><\/ul>/i);
    expect(html).to.match(/<ul\s+id="manage-events"\s+class="event-list"[^>]*><\/ul>/i);
  });

  it("keeps deployment details in the footer without a top network banner", function () {
    const html = fs.readFileSync(path.join(projectRoot, "frontend/index.html"), "utf8");
    expect(html).not.to.match(/BOT Chain (?:Testnet|Mainnet)/);
    expect(html).not.to.match(/https:\/\/(?:rpc|scan)\.(?:bohr\.life|botchain\.ai)/);
    expect(html).not.to.include('id="deployment-banner"');
    expect(html).not.to.include('id="network-contract-link"');
    expect(html).not.to.include('class="network-bar"');
    expect(html).to.include('id="footer-network-label">Loading network…');
    expect(html).to.match(/id="contract-link"[^>]*aria-disabled="true"/);
  });

  it("populates active footer deployment details from configuration", async function () {
    const { applyDeploymentPresentation } = await importModule(
      "frontend/src/pass/controller.mjs"
    );
    const elements = Object.fromEntries(
      ["contract-link", "footer-network-label"].map((id) => [
        id,
        new TestElement("DIV"),
      ])
    );
    const previousDocument = global.document;
    global.document = {
      querySelector: (selector) => elements[selector.slice(1)],
    };
    try {
      applyDeploymentPresentation(
        {
          networkName: "BOT Chain Mainnet",
          chainId: 677,
          explorerUrl: "https://scan.botchain.ai",
          contractAddress: "0x1111111111111111111111111111111111111111",
        },
        { active: true }
      );

      expect(elements["footer-network-label"].textContent).to.equal(
        "BOT Chain Mainnet"
      );
      expect(elements["contract-link"].textContent).to.equal("View on BOTScan");
      expect(elements["contract-link"].href).to.equal(
        "https://scan.botchain.ai/address/0x1111111111111111111111111111111111111111"
      );
      expect(elements["contract-link"].attributes).not.to.have.property(
        "aria-disabled"
      );

      applyDeploymentPresentation(
        {
          networkName: "BOT Chain Testnet",
          chainId: 968,
          explorerUrl: "https://scan.bohr.life",
          contractAddress: "0x2222222222222222222222222222222222222222",
        },
        { active: true }
      );
      expect(elements["footer-network-label"].textContent).to.equal(
        "BOT Chain Testnet"
      );
      expect(elements["contract-link"].href).to.equal(
        "https://scan.bohr.life/address/0x2222222222222222222222222222222222222222"
      );
    } finally {
      global.document = previousDocument;
    }
  });

  it("keeps a pending configured deployment truthful and disabled", async function () {
    const { applyDeploymentPresentation } = await importModule(
      "frontend/src/pass/controller.mjs"
    );
    const elements = Object.fromEntries(
      ["contract-link", "footer-network-label"].map((id) => [
        id,
        new TestElement("DIV"),
      ])
    );
    const previousDocument = global.document;
    global.document = {
      querySelector: (selector) => elements[selector.slice(1)],
    };
    try {
      applyDeploymentPresentation(
        {
          networkName: "BOT Chain Mainnet",
          chainId: 677,
          explorerUrl: "https://scan.botchain.ai",
          contractAddress: null,
        },
        { active: false }
      );

      expect(elements["footer-network-label"].textContent).to.equal(
        "BOT Chain Mainnet"
      );
      expect(elements["contract-link"]).not.to.have.property("href");
      expect(elements["contract-link"].attributes["aria-disabled"]).to.equal(
        "true"
      );
      expect(elements["contract-link"].textContent).to.equal(
        "Contract unavailable"
      );
    } finally {
      global.document = previousDocument;
    }
  });

  it("orders event rows by lifecycle and gives each lifecycle its contextual action", async function () {
    const {
      formatEventTimeRange,
      getEventListCta,
      sortEventsByLifecycle,
    } = await importModule("frontend/src/pass/controller.mjs");
    const organizer = "0x1111111111111111111111111111111111111111";
    const now = 1_800_000_000n;
    const events = [
      { ...event(organizer, "Ended"), id: 11n, endTime: now - 1n },
      { ...event(organizer, "Available first"), id: 2n, startTime: now - 1n, endTime: now + 1_000n },
      { ...event(organizer, "Paused"), id: 9n, claimOpen: false, startTime: now - 1n, endTime: now + 1_000n },
      { ...event(organizer, "Upcoming"), id: 8n, startTime: now + 1n, endTime: now + 1_000n },
      { ...event(organizer, "Available second"), id: 5n, startTime: now - 1n, endTime: now + 1_000n },
    ];

    expect(sortEventsByLifecycle(events, now).map(({ id }) => id)).to.deep.equal([
      5n,
      2n,
      8n,
      9n,
      11n,
    ]);
    expect(getEventListCta({ key: "available" })).to.equal("View & get pass");
    expect(getEventListCta({ key: "upcoming" })).to.equal("View details");
    expect(getEventListCta({ key: "paused" })).to.equal("View details");
    expect(getEventListCta({ key: "ended" })).to.equal("View details");
    expect(getEventListCta({ key: "available" }, { manage: true })).to.equal("Manage event");
    expect(formatEventTimeRange(1_800_000_000n, 1_800_003_600n)).to.match(/\d.*–.*\d/);
  });

  it("maps every event row field to a readable labeled value", async function () {
    const { formatEventId, getEventListRowData } = await importModule("frontend/src/pass/controller.mjs");
    const row = getEventListRowData(
      {
        ...event("0x1111111111111111111111111111111111111111", "Open studio"),
        id: 42n,
      },
      { now: 1_800_000_001n }
    );

    expect(row).to.include({
      lifecycle: "Passes available",
      eventId: "Event ID: 42",
      title: "Open studio",
      action: "View & get pass",
    });
    expect(formatEventId(42n)).to.equal("Event ID: 42");
    expect(row.metadata.map(({ label }) => label)).to.deep.equal([
      "Time",
      "Location",
      "Organizer",
      "Passes",
    ]);
    expect(row.metadata[0].value).to.match(/\d.*–.*\d/);
    expect(row.metadata[1].value).to.equal("Makassar");
    expect(row.metadata[2].value).to.equal("0x1111…1111");
    expect(row.metadata[3].value).to.equal("2 passes issued");
  });

  it("uses singular pass-count copy only for exactly one pass", async function () {
    const { getEventListRowData } = await importModule(
      "frontend/src/pass/controller.mjs"
    );
    const organizer = "0x1111111111111111111111111111111111111111";
    const rowFor = (passCount) =>
      getEventListRowData(
        { ...event(organizer), id: 42n, passCount },
        { now: 1_800_000_001n }
      ).metadata[3].value;

    expect(rowFor(0n)).to.equal("0 passes issued");
    expect(rowFor(1n)).to.equal("1 pass issued");
    expect(rowFor(2n)).to.equal("2 passes issued");
  });

  it("renders each event as one semantic row with one contextual link", async function () {
    const { renderEventListRow } = await importModule("frontend/src/pass/controller.mjs");
    const previousDocument = global.document;
    global.document = { createElement: (tagName) => new TestElement(tagName) };
    try {
      const row = renderEventListRow(
        { ...event("0x1111111111111111111111111111111111111111"), id: 7n },
        { now: 1_800_000_001n }
      );
      const links = descendants(row, "a");
      const labels = descendants(row, "dt").map(({ textContent }) => textContent);
      const header = row.children[0];

      expect(row.tagName).to.equal("li");
      expect(header.children[0].children[1].textContent).to.equal(
        "Passes available"
      );
      expect(header.children[1].textContent).to.equal("Event ID: 7");
      expect(links).to.have.length(1);
      expect(links[0].textContent).to.equal("View & get pass");
      expect(labels).to.deep.equal(["Time", "Location", "Organizer", "Passes"]);
    } finally {
      global.document = previousDocument;
    }
  });

  it("derives attendee-facing pass availability from the event window", async function () {
    const {
      assertReviewedDeploymentWritesEnabled,
      getEventAvailability,
      getNextLifecycleRefreshDelay,
      getPassActionState,
    } = await importModule("frontend/src/pass/controller.mjs");
    const active = event("0x1111111111111111111111111111111111111111");

    expect(getEventAvailability(active, 1_799_999_999n)).to.deep.include({
      key: "upcoming",
      label: "Upcoming",
      canGetPass: false,
    });
    expect(getEventAvailability(active, 1_800_000_001n)).to.deep.include({
      key: "available",
      label: "Passes available",
      canGetPass: true,
    });
    expect(getEventAvailability(active, 1_800_000_000n).canGetPass).to.equal(true);
    expect(getEventAvailability(active, 1_800_003_600n).canGetPass).to.equal(true);
    expect(getEventAvailability({ ...active, claimOpen: false }, 1_800_000_001n)).to.deep.include({
      key: "paused",
      label: "Passes paused",
      canGetPass: false,
    });
    expect(getEventAvailability(active, 1_800_003_601n)).to.deep.include({
      key: "ended",
      label: "Ended",
      canGetPass: false,
    });
    expect(getNextLifecycleRefreshDelay([active], 1_799_999_999n)).to.equal(1_000);
    expect(getNextLifecycleRefreshDelay([active], 1_800_003_600n)).to.equal(1_000);
    expect(getNextLifecycleRefreshDelay([active], 1_800_003_601n)).to.equal(null);

    const available = getEventAvailability(active, 1_800_000_001n);
    expect(getPassActionState({ availability: available, hasPass: false, writesEnabled: true })).to.include({
      label: "Get pass",
      disabled: false,
    });
    expect(getPassActionState({ availability: available, hasPass: false, writesEnabled: false })).to.deep.equal({
      label: "Get pass",
      disabled: true,
      reason: "Pass actions are unavailable in this read-only environment.",
    });
    expect(getPassActionState({ availability: available, hasPass: true, writesEnabled: true })).to.deep.equal({
      label: "Pass added",
      disabled: true,
      reason: null,
    });
    expect(() => assertReviewedDeploymentWritesEnabled(false)).to.throw(
      "BOTPass writes require an active reviewed deployment."
    );
    expect(() => assertReviewedDeploymentWritesEnabled(true)).not.to.throw();
  });

  it("normalizes legacy demo titles before generic public terminology", async function () {
    const { toPublicEventCopy } = await importModule("frontend/src/pass/controller.mjs");
    expect(toPublicEventCopy("BOTPass Open Claim Demo")).to.equal(
      "BOTPass Attendance Demo"
    );
    expect(
      toPublicEventCopy("Functional Open Claim acceptance event on BOT Chain Testnet.")
    ).to.equal(
      "Live attendance-pass demo on BOT Chain Testnet."
    );
    expect(
      toPublicEventCopy("Open Claim with QR code and previous deployment notes")
    ).to.equal(
      "event pass with check-in code and network notes"
    );
  });

  it("recognizes organizer controls without address-case ambiguity", async function () {
    const { isEventOrganizer } = await importModule("frontend/src/pass/controller.mjs");
    const organizer = "0xAbCdEf0000000000000000000000000000000000";
    expect(isEventOrganizer({ organizer }, organizer.toLowerCase())).to.equal(true);
    expect(isEventOrganizer(
      { organizer: "0xe604829a9c327b0d924718CfAcEF69BBdC8C0Efc" },
      "0xe604829A9C327B0D924718cFACEf69bbDC8c0eFC"
    )).to.equal(true);
    expect(isEventOrganizer({ organizer }, "0x1111111111111111111111111111111111111111")).to.equal(false);
    expect(isEventOrganizer({ organizer }, null)).to.equal(false);
  });

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

  it("requests an account choice and returns the selected wallet snapshot", async function () {
    const { requestWalletAccountSwitch } = await importModule("frontend/src/wallet.js");
    const calls = [];
    const provider = {
      request: async ({ method, params }) => {
        calls.push({ method, params });
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
        if (method === "eth_accounts") return ["0x2222222222222222222222222222222222222222"];
        if (method === "eth_chainId") return "0x3c8";
        return null;
      },
    };

    const result = await requestWalletAccountSwitch({ provider });
    expect(result.supported).to.equal(true);
    expect(result.snapshot).to.include({
      account: "0x2222222222222222222222222222222222222222",
      chainId: 968,
    });
    expect(calls[0]).to.deep.equal({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  });

  it("keeps an explicit BOTPass disconnect local and reversible", async function () {
    const {
      clearWalletDisconnected,
      isWalletDisconnected,
      markWalletDisconnected,
    } = await importModule("frontend/src/wallet.js");
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };

    expect(isWalletDisconnected(storage)).to.equal(false);
    markWalletDisconnected(storage);
    expect(isWalletDisconnected(storage)).to.equal(true);
    clearWalletDisconnected(storage);
    expect(isWalletDisconnected(storage)).to.equal(false);
  });

  it("applies only the latest wallet event and contains refresh failures", async function () {
    const { createWalletRefreshHandler } = await importModule("frontend/src/wallet.js");
    const pending = [];
    const applied = [];
    const errors = [];
    let clears = 0;
    let renders = 0;
    let disconnected = false;
    const refresh = createWalletRefreshHandler({
      isDisconnected: () => disconnected,
      clear: () => { clears += 1; },
      read: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      apply: (snapshot) => applied.push(snapshot.account),
      render: async () => { renders += 1; },
      onError: (error) => errors.push(error.message),
    });

    const first = refresh();
    const second = refresh();
    pending[1].resolve({ account: "second" });
    await second;
    pending[0].resolve({ account: "first" });
    await first;
    expect(applied).to.deep.equal(["second"]);
    expect(clears).to.equal(2);
    expect(renders).to.equal(1);

    const failed = refresh();
    pending[2].reject(new Error("wallet read failed"));
    await failed;
    expect(errors).to.deep.equal(["wallet read failed"]);
    expect(clears).to.equal(4);
    expect(renders).to.equal(2);

    const interrupted = refresh();
    disconnected = true;
    pending[3].resolve({ account: "must-not-reconnect" });
    await interrupted;
    expect(applied).to.deep.equal(["second"]);
    expect(clears).to.equal(5);
    expect(renders).to.equal(2);
  });

  it("maps contract errors to pass language for attendees", async function () {
    const { describeError } = await importModule("frontend/src/errors.js");
    expect(describeError({ code: "AlreadyClaimed" }).message).to.equal(
      "This wallet already has a pass for this event."
    );
    expect(describeError({ code: "ClaimClosed" }).message).to.equal(
      "Passes are currently paused by the organizer."
    );
    const internalFailure = describeError({
      message: "contract.claimOpen is not a function",
    });
    expect(internalFailure.message).to.equal(
      "The action could not be completed. Check your wallet and try again."
    );
    expect(internalFailure.message).not.to.match(/claim/i);
  });
});
