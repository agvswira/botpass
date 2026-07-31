import { getAddress, isAddress } from "ethers";
import {
  createPublicReadProvider,
  getReadContract,
  getWriteContract,
  readEventFromContract,
  readLatestEventsFromContract,
  readOrganizerEventsFromContract,
  readWalletPassesFromContract,
} from "../contract.js";
import { describeError } from "../errors.js";
import { FRONTEND_CONFIG, hasActiveDeployment } from "../networks.js";
import {
  bindWalletEvents,
  clearWalletDisconnected,
  isWalletDisconnected,
  markWalletDisconnected,
  readWalletSnapshot,
  requestWalletAccountSwitch,
  switchOrAddBotChain,
} from "../wallet.js";
import { parseRoute } from "./routing.mjs";

const formatDate = (value) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(Number(value) * 1000));
const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function getEventAvailability(event, now = BigInt(Math.floor(Date.now() / 1000))) {
  const currentTime = BigInt(now);
  if (currentTime < BigInt(event.startTime)) {
    return {
      key: "upcoming",
      label: "Upcoming",
      canGetPass: false,
      reason: "Passes become available when the event starts.",
    };
  }
  if (currentTime > BigInt(event.endTime)) {
    return {
      key: "ended",
      label: "Ended",
      canGetPass: false,
      reason: "This event has ended.",
    };
  }
  if (!event.claimOpen) {
    return {
      key: "paused",
      label: "Passes paused",
      canGetPass: false,
      reason: "Passes are currently paused by the organizer.",
    };
  }
  return {
    key: "available",
    label: "Passes available",
    canGetPass: true,
    reason: "Connect a wallet and confirm one transaction.",
  };
}

export function isEventOrganizer(event, account) {
  return Boolean(
    account && event.organizer.toLowerCase() === account.toLowerCase()
  );
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function availabilityIndicator(availability) {
  const status = element("span", "availability");
  status.dataset.state = availability.key;
  status.append(
    element("span", "availability-dot"),
    element("span", "", availability.label)
  );
  return status;
}

function eventCard(event, { manage = false } = {}) {
  const availability = getEventAvailability(event);
  const card = element("article", "event-card");
  const cardHeader = element("div", "event-card-header");
  cardHeader.append(
    availabilityIndicator(availability),
    element("span", "event-id", `Event #${event.id}`)
  );
  const content = element("div", "event-card-content");
  content.append(
    element("h3", "", event.name),
    element("p", "", event.description)
  );
  const metadata = element("div", "event-metadata");
  metadata.append(
    element("span", "", event.location),
    element("span", "", formatDate(event.startTime)),
    element("span", "", `${event.passCount} passes issued`)
  );
  const link = element("a", "event-card-link", manage ? "Manage event" : "View event");
  link.href = `./?event=${event.id}`;
  link.append(element("span", "", " →"));
  card.append(cardHeader, content, metadata, link);
  return card;
}

export function createAppController() {
  const wallet = {
    account: null,
    chainId: null,
    browserProvider: null,
    injectedProvider: null,
  };
  let readProvider = null;
  let readContract = null;

  function setStatus(message, hidden = false) {
    const node = document.querySelector("#transaction-status");
    node.textContent = message;
    node.hidden = hidden;
  }

  function showError(error) {
    setStatus(describeError(error).message);
  }

  function updateWallet() {
    const button = document.querySelector("#connect-button");
    document.querySelector("#wallet-button-label").textContent = wallet.account
      ? shortAddress(wallet.account)
      : "Connect wallet";
    document.querySelector("#wallet-address").textContent = wallet.account ?? "";
    button.classList.toggle("connected", Boolean(wallet.account));
    if (!wallet.account) setWalletMenu(false);
  }

  function setWalletMenu(open) {
    const button = document.querySelector("#connect-button");
    const menu = document.querySelector("#wallet-menu");
    const visible = Boolean(open && wallet.account);
    button.setAttribute("aria-expanded", String(visible));
    menu.hidden = !visible;
  }

  async function connect() {
    if (!hasActiveDeployment()) throw new Error("The BOTPass contract is not available.");
    let snapshot = await readWalletSnapshot({ requestAccounts: true });
    if (snapshot.chainId !== FRONTEND_CONFIG.chainId) snapshot = await switchOrAddBotChain();
    Object.assign(wallet, snapshot);
    clearWalletDisconnected();
    updateWallet();
    await renderRoute();
    return snapshot;
  }

  async function switchAccount() {
    const result = await requestWalletAccountSwitch({
      provider: wallet.injectedProvider,
    });
    if (!result.supported) {
      throw new Error(
        "Switch accounts in your wallet extension, then return to BOTPass."
      );
    }
    let snapshot = result.snapshot;
    if (snapshot.chainId !== FRONTEND_CONFIG.chainId) {
      snapshot = await switchOrAddBotChain({
        provider: snapshot.injectedProvider,
      });
    }
    Object.assign(wallet, snapshot);
    clearWalletDisconnected();
    setWalletMenu(false);
    updateWallet();
    await renderRoute();
  }

  async function disconnect() {
    markWalletDisconnected();
    Object.assign(wallet, {
      account: null,
      chainId: null,
      browserProvider: null,
      injectedProvider: null,
    });
    setWalletMenu(false);
    updateWallet();
    await renderRoute();
    setStatus("Wallet disconnected from BOTPass.");
  }

  async function requireWriteContract() {
    if (!FRONTEND_CONFIG.writesEnabled) {
      throw new Error("BOTPass writes are enabled only for the interactive Testnet demo.");
    }
    if (!wallet.account) await connect();
    if (wallet.chainId !== FRONTEND_CONFIG.chainId) Object.assign(wallet, await switchOrAddBotChain());
    return getWriteContract(wallet.browserProvider);
  }

  async function transact(label, send, confirm) {
    setStatus(`Confirm ${label} in your wallet…`);
    const transaction = await send();
    setStatus(`Transaction submitted: ${transaction.hash}. Waiting for confirmation…`);
    const receipt = await transaction.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error(`${label} failed.`);
    await confirm?.();
    setStatus(`${label} confirmed on BOT Chain.`);
    return receipt;
  }

  async function loadEvents(container, filter) {
    container.replaceChildren();
    if (!readContract) return [];
    const events = filter
      ? await filter(readContract)
      : await readLatestEventsFromContract(readContract);
    events.forEach((event) => container.append(eventCard(event, { manage: Boolean(filter) })));
    return events;
  }

  async function renderHome() {
    const events = await loadEvents(document.querySelector("#home-events"));
    document.querySelector("#event-count").textContent = `${events.length} event${events.length === 1 ? "" : "s"}`;
  }

  async function renderManage() {
    const container = document.querySelector("#manage-events");
    container.replaceChildren();
    if (!wallet.account || !readContract) return;
    await loadEvents(container, (contract) => readOrganizerEventsFromContract(contract, wallet.account));
  }

  async function renderPasses() {
    const container = document.querySelector("#wallet-passes");
    container.replaceChildren();
    if (!wallet.account || !readContract) return;
    const passes = await readWalletPassesFromContract(readContract, wallet.account);
    passes.forEach((pass) => {
      const card = element("article", "pass-card");
      const passHeading = element("div", "pass-card-heading");
      passHeading.append(
        element("span", "verification-mark", "✓ Pass verified"),
        element("span", "event-id", `Event #${pass.eventId}`)
      );
      const passContent = element("div", "pass-card-content");
      passContent.append(
        element("h3", "", pass.event.name),
        element("p", "", `Added ${formatDate(pass.claimedAt)}`)
      );
      const link = element("a", "event-card-link", "View event");
      link.href = `./?event=${pass.eventId}`;
      link.append(element("span", "", " →"));
      card.append(passHeading, passContent, link);
      container.append(card);
    });
  }

  function fact(label, value) {
    const wrapper = element("div");
    wrapper.append(element("dt", "", label), element("dd", "", value));
    return wrapper;
  }

  async function renderEvent(eventId) {
    const container = document.querySelector("#event-detail");
    container.replaceChildren();
    if (!readContract) {
      container.append(element("h1", "", "Event unavailable"), element("p", "", "The BOTPass contract is not available."));
      return;
    }
    const event = await readEventFromContract(readContract, eventId);
    const availability = getEventAvailability(event);
    const passAddedAt = wallet.account
      ? BigInt(await readContract.claimedAt(event.id, wallet.account))
      : 0n;
    const hasPass = passAddedAt > 0n;
    const head = element("div", "detail-head");
    const heading = element("div");
    heading.append(element("p", "eyebrow", `EVENT #${event.id}`), element("h1", "", event.name), element("p", "lead", event.description));
    head.append(heading, availabilityIndicator(availability));
    const facts = element("dl", "facts");
    facts.append(fact("Organizer", shortAddress(event.organizer)), fact("Location", event.location), fact("Starts", formatDate(event.startTime)), fact("Ends", formatDate(event.endTime)), fact("Passes issued", event.passCount.toString()));
    const attendeePanel = element("div", "event-action-panel");
    const attendeeCopy = element("div");
    attendeeCopy.append(
      element("h2", "", hasPass ? "Pass added" : "Get your event pass"),
      element(
        "p",
        "action-note",
        hasPass
          ? `This wallet added its pass on ${formatDate(passAddedAt)}.`
          : availability.reason
      )
    );
    const getPass = element("button", "button primary", hasPass ? "Pass added" : "Get pass");
    getPass.type = "button";
    getPass.disabled = hasPass || !availability.canGetPass || !FRONTEND_CONFIG.writesEnabled;
    getPass.addEventListener("click", async () => {
      try {
        const contract = await requireWriteContract();
        await transact("Get pass", () => contract.claimOpen(event.id), () => renderEvent(event.id));
      } catch (error) { showError(error); }
    });
    attendeePanel.append(attendeeCopy, getPass);
    container.append(head, facts, attendeePanel);
    if (
      FRONTEND_CONFIG.writesEnabled &&
      isEventOrganizer(event, wallet.account)
    ) {
      const organizerPanel = element("div", "organizer-panel");
      const organizerCopy = element("div");
      organizerCopy.append(
        element("p", "eyebrow", "ORGANIZER CONTROLS"),
        element("h2", "", "Pass availability"),
        element("p", "action-note", "Only this event’s organizer can change this setting.")
      );
      const toggle = element("button", "button secondary", event.claimOpen ? "Pause passes" : "Enable passes");
      toggle.type = "button";
      toggle.addEventListener("click", async () => {
        try {
          const contract = await requireWriteContract();
          const label = event.claimOpen ? "Pause passes" : "Enable passes";
          await transact(label, () => contract.setClaimOpen(event.id, !event.claimOpen), () => renderEvent(event.id));
        } catch (error) { showError(error); }
      });
      organizerPanel.append(organizerCopy, toggle);
      container.append(organizerPanel);
    }
  }

  function showRoute() {
    const route = parseRoute(location.search);
    document.querySelectorAll("[data-page]").forEach((node) => { node.hidden = node.dataset.page !== route.name; });
    document.querySelectorAll("[data-link]").forEach((node) => {
      const activeRoute = route.name === "event" ? "home" : route.name;
      if (node.matches("nav a")) node.toggleAttribute("aria-current", node.dataset.link === activeRoute);
    });
    return route;
  }

  async function renderRoute() {
    const route = showRoute();
    if (route.name === "home") await renderHome();
    if (route.name === "manage") await renderManage();
    if (route.name === "passes") await renderPasses();
    if (route.name === "event") await renderEvent(route.eventId);
  }

  function bindForms() {
    document.querySelector("#create-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const data = new FormData(event.currentTarget);
        const start = Math.floor(new Date(data.get("start")).getTime() / 1000);
        const end = Math.floor(new Date(data.get("end")).getTime() / 1000);
        const contract = await requireWriteContract();
        await transact("Create event", () => contract.createEvent(data.get("name").trim(), data.get("description").trim(), data.get("location").trim(), start, end));
        location.assign("./?manage");
      } catch (error) { showError(error); }
    });
    document.querySelector("#verify-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = document.querySelector("#verify-result");
      try {
        if (!readContract) throw new Error("The BOTPass contract is not available.");
        const data = new FormData(event.currentTarget);
        const eventId = data.get("eventId").trim();
        const walletAddress = data.get("wallet").trim();
        if (!/^[1-9][0-9]*$/.test(eventId) || !isAddress(walletAddress)) throw new Error("Enter a valid event ID and wallet address.");
        const [claimedAt, details] = await Promise.all([readContract.claimedAt(eventId, getAddress(walletAddress)), readEventFromContract(readContract, eventId)]);
        const valid = BigInt(claimedAt) > 0n;
        result.replaceChildren(
          element("h2", "", valid ? "Pass verified" : "No pass found"),
          element(
            "p",
            "",
            valid
              ? `${shortAddress(getAddress(walletAddress))} added a pass for ${details.name} on ${formatDate(claimedAt)}.`
              : `${shortAddress(getAddress(walletAddress))} does not have a pass for ${details.name}.`
          )
        );
        result.dataset.valid = String(valid);
        result.hidden = false;
      } catch (error) { result.hidden = true; showError(error); }
    });
  }

  function bindWalletMenu() {
    const control = document.querySelector(".wallet-control");
    const button = document.querySelector("#connect-button");
    button.addEventListener("click", () => {
      if (wallet.account) {
        setWalletMenu(button.getAttribute("aria-expanded") !== "true");
      } else {
        connect().catch(showError);
      }
    });
    document.querySelector("#copy-wallet-button").addEventListener("click", async () => {
      try {
        if (!wallet.account || !navigator.clipboard?.writeText) {
          throw new Error("Copy the address directly from your wallet extension.");
        }
        await navigator.clipboard.writeText(wallet.account);
        setWalletMenu(false);
        setStatus("Wallet address copied.");
      } catch (error) { showError(error); }
    });
    document.querySelector("#switch-wallet-button").addEventListener("click", () => switchAccount().catch(showError));
    document.querySelector("#disconnect-wallet-button").addEventListener("click", () => disconnect().catch(showError));
    document.addEventListener("click", (event) => {
      if (!control.contains(event.target)) setWalletMenu(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setWalletMenu(false);
        button.focus();
      }
    });
  }

  async function initialize() {
    showRoute();
    const active = hasActiveDeployment();
    const banner = document.querySelector("#deployment-banner");
    banner.dataset.state = active ? "active" : "pending";
    document.querySelector("#deployment-title").textContent = active ? "BOT Chain Testnet" : "Contract unavailable";
    document.querySelector("#deployment-message").textContent = active ? `Contract ${shortAddress(FRONTEND_CONFIG.contractAddress)} · Chain ${FRONTEND_CONFIG.chainId}` : "Read and write actions are unavailable.";
    const contractUrl = active ? `${FRONTEND_CONFIG.explorerUrl}/address/${FRONTEND_CONFIG.contractAddress}` : FRONTEND_CONFIG.explorerUrl;
    document.querySelector("#contract-link").href = contractUrl;
    document.querySelector("#network-contract-link").href = contractUrl;
    document.querySelector("#connect-button").disabled = !active;
    document.querySelector("#create-form button[type=submit]").disabled =
      !FRONTEND_CONFIG.writesEnabled;
    bindWalletMenu();
    bindForms();
    if (active) {
      try {
        readProvider = await createPublicReadProvider();
        readContract = getReadContract(readProvider);
        if (!isWalletDisconnected()) {
          Object.assign(wallet, await readWalletSnapshot());
        }
        bindWalletEvents({
          onAccountsChanged: async () => {
            if (isWalletDisconnected()) return;
            Object.assign(wallet, await readWalletSnapshot());
            updateWallet();
            await renderRoute();
          },
          onChainChanged: async () => {
            if (isWalletDisconnected()) return;
            Object.assign(wallet, await readWalletSnapshot());
            updateWallet();
            await renderRoute();
          },
        });
      } catch (error) {
        banner.dataset.state = "pending";
        document.querySelector("#deployment-title").textContent = "BOT Chain RPC unavailable";
        document.querySelector("#deployment-message").textContent = "Contract data could not be loaded. Refresh to retry.";
        showError(error);
      }
      updateWallet();
    }
    await renderRoute();
  }

  return { initialize, renderRoute };
}
