import { getAddress, isAddress } from "ethers";
import {
  createPublicReadProvider,
  getReadContract,
  getWriteContract,
  readLatestBlockTimestamp,
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
  createWalletRefreshHandler,
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

export function formatEventTimeRange(startTime, endTime) {
  return `${formatDate(startTime)} – ${formatDate(endTime)}`;
}

export function toPublicEventCopy(value) {
  return String(value)
    .replace(/\bopen claims?\b/gi, "event pass")
    .replace(/\bclaiming\b/gi, "getting a pass")
    .replace(/\bclaimed\b/gi, "added a pass")
    .replace(/\bclaims\b/gi, "passes")
    .replace(/\bclaim\b/gi, "pass")
    .replace(/\bQR(?:\s+code)?\b/gi, "check-in code")
    .replace(/\b(?:previous|old|legac[y])\s+deployment\b/gi, "network")
    .replace(/\blegac[y] behavior\b/gi, "earlier behavior")
    .replace(/\bremoved (?:flow|feature)\b/gi, "earlier option");
}

export function getEventAvailability(event, now) {
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

const LIFECYCLE_RANK = Object.freeze({
  available: 0,
  upcoming: 1,
  paused: 2,
  ended: 3,
});

export function sortEventsByLifecycle(events, now) {
  return [...events].sort((left, right) => {
    const lifecycleDifference =
      LIFECYCLE_RANK[getEventAvailability(left, now).key] -
      LIFECYCLE_RANK[getEventAvailability(right, now).key];
    if (lifecycleDifference !== 0) return lifecycleDifference;
    return left.id === right.id ? 0 : left.id > right.id ? -1 : 1;
  });
}

export function getEventListCta(availability, { manage = false } = {}) {
  if (manage) return "Manage event";
  return availability.key === "available" ? "View & get pass" : "View details";
}

export function getEventListRowData(event, { manage = false, now } = {}) {
  const availability = getEventAvailability(event, now);
  return {
    lifecycle: availability.label,
    lifecycleKey: availability.key,
    eventId: `Event #${event.id}`,
    title: toPublicEventCopy(event.name),
    description: toPublicEventCopy(event.description),
    metadata: [
      { label: "When", value: formatEventTimeRange(event.startTime, event.endTime) },
      { label: "Where", value: toPublicEventCopy(event.location) },
      { label: "Organizer", value: shortAddress(event.organizer) },
      { label: "Passes", value: `${event.passCount} passes issued` },
    ],
    action: getEventListCta(availability, { manage }),
  };
}

export function getNextLifecycleRefreshDelay(events, now) {
  if (now === null || events.length === 0) return null;
  const currentTime = BigInt(now);
  let nextBoundary = null;
  for (const event of events) {
    const startTime = BigInt(event.startTime);
    const endTime = BigInt(event.endTime);
    const boundary = currentTime < startTime
      ? startTime
      : currentTime <= endTime
        ? endTime + 1n
        : null;
    if (boundary !== null && (nextBoundary === null || boundary < nextBoundary)) {
      nextBoundary = boundary;
    }
  }
  if (nextBoundary === null) return null;
  return Math.min(Number(nextBoundary - currentTime) * 1_000, 2_147_000_000);
}

export function isEventOrganizer(event, account) {
  return Boolean(
    account && event.organizer.toLowerCase() === account.toLowerCase()
  );
}

export function getPassActionState({ availability, hasPass, writesEnabled }) {
  if (hasPass) {
    return { label: "Pass added", disabled: true, reason: null };
  }
  if (!availability.canGetPass) {
    return { label: "Get pass", disabled: true, reason: availability.reason };
  }
  if (!writesEnabled) {
    return {
      label: "Get pass",
      disabled: true,
      reason: "Pass actions are unavailable in this read-only environment.",
    };
  }
  return {
    label: "Get pass",
    disabled: false,
    reason: availability.reason,
  };
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

export function setListState(container, state, title, message) {
  const wrapper = element(
    container.tagName === "UL" ? "li" : "div",
    `list-state ${state}`
  );
  wrapper.setAttribute("role", state === "error" ? "alert" : "status");
  wrapper.append(element("strong", "", title));
  if (message) wrapper.append(element("span", "", message));
  container.replaceChildren(wrapper);
  container.setAttribute("aria-busy", String(state === "loading"));
}

export function renderEventListRow(event, { manage = false, now } = {}) {
  const row = getEventListRowData(event, { manage, now });
  const card = element("li", "event-row");
  const cardHeader = element("div", "event-card-header");
  cardHeader.append(
    availabilityIndicator({ key: row.lifecycleKey, label: row.lifecycle }),
    element("span", "event-id", row.eventId)
  );
  const content = element("div", "event-card-content");
  content.append(
    element("h3", "", row.title),
    element("p", "", row.description)
  );
  const metadata = element("dl", "event-metadata");
  row.metadata.forEach(({ label, value }) => {
    const item = element("div", "event-metadata-item");
    item.append(element("dt", "", label), element("dd", "", value));
    metadata.append(item);
  });
  const link = element("a", "event-card-link", row.action);
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
  let lifecycleTimer = null;
  let routeRenderGeneration = 0;

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

  function clearConnectedWallet() {
    Object.assign(wallet, {
      account: null,
      chainId: null,
      browserProvider: null,
      injectedProvider: null,
    });
    updateWallet();
    document.querySelectorAll(".organizer-panel").forEach((node) => node.remove());
    document.querySelector("#manage-events").replaceChildren();
    document.querySelector("#wallet-passes").replaceChildren();
  }

  function setWalletMenu(open, { restoreFocus = false } = {}) {
    const button = document.querySelector("#connect-button");
    const menu = document.querySelector("#wallet-menu");
    const visible = Boolean(open && wallet.account);
    const shouldRestoreFocus = !visible && restoreFocus && menu.contains(document.activeElement);
    button.setAttribute("aria-expanded", String(visible));
    menu.hidden = !visible;
    if (shouldRestoreFocus) button.focus();
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
      setWalletMenu(false, { restoreFocus: true });
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
    setWalletMenu(false, { restoreFocus: true });
    updateWallet();
    await renderRoute();
  }

  async function disconnect() {
    markWalletDisconnected();
    setWalletMenu(false, { restoreFocus: true });
    clearConnectedWallet();
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

  function scheduleLifecycleRefresh(events, now) {
    if (lifecycleTimer !== null) clearTimeout(lifecycleTimer);
    const delay = getNextLifecycleRefreshDelay(events, now);
    if (delay === null) {
      lifecycleTimer = null;
      return;
    }
    lifecycleTimer = setTimeout(() => {
      lifecycleTimer = null;
      renderRoute().catch(showError);
    }, delay);
  }

  async function loadEvents(container, filter, now, generation) {
    container.replaceChildren();
    if (!readContract) return [];
    setListState(container, "loading", "Loading events…");
    try {
      const events = filter
        ? await filter(readContract)
        : await readLatestEventsFromContract(readContract);
      if (generation !== routeRenderGeneration) return null;
      container.replaceChildren();
      const sortedEvents = sortEventsByLifecycle(events, now);
      sortedEvents.forEach((event) => container.append(renderEventListRow(event, { manage: Boolean(filter), now })));
      return sortedEvents;
    } catch (error) {
      if (generation !== routeRenderGeneration) return null;
      setListState(container, "error", "Events could not be loaded", "Refresh the page to retry.");
      throw error;
    } finally {
      if (generation === routeRenderGeneration) {
        container.setAttribute("aria-busy", "false");
      }
    }
  }

  async function renderHome(now, generation) {
    const events = await loadEvents(document.querySelector("#home-events"), null, now, generation);
    if (events === null) return;
    document.querySelector("#event-count").textContent = `${events.length} event${events.length === 1 ? "" : "s"}`;
    scheduleLifecycleRefresh(events, now);
  }

  async function renderManage(now, generation) {
    const container = document.querySelector("#manage-events");
    container.replaceChildren();
    if (!wallet.account || !readContract) return;
    const account = wallet.account;
    const events = await loadEvents(container, (contract) => readOrganizerEventsFromContract(contract, account), now, generation);
    if (events === null) return;
    scheduleLifecycleRefresh(events, now);
  }

  async function renderPasses(generation) {
    const container = document.querySelector("#wallet-passes");
    container.replaceChildren();
    if (!wallet.account || !readContract) return;
    setListState(container, "loading", "Loading passes…");
    let passes;
    try {
      passes = await readWalletPassesFromContract(readContract, wallet.account);
      if (generation !== routeRenderGeneration) return;
      container.replaceChildren();
    } catch (error) {
      if (generation !== routeRenderGeneration) return;
      setListState(container, "error", "Passes could not be loaded", "Check the network and retry.");
      throw error;
    } finally {
      if (generation === routeRenderGeneration) {
        container.setAttribute("aria-busy", "false");
      }
    }
    passes.forEach((pass) => {
      const card = element("article", "pass-card");
      const passHeading = element("div", "pass-card-heading");
      passHeading.append(
        element("span", "verification-mark", "✓ Pass verified"),
        element("span", "event-id", `Event #${pass.eventId}`)
      );
      const passContent = element("div", "pass-card-content");
      passContent.append(
        element("h3", "", toPublicEventCopy(pass.event.name)),
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

  async function renderEvent(eventId, now, generation) {
    const container = document.querySelector("#event-detail");
    container.replaceChildren();
    if (!readContract) {
      container.append(element("h1", "", "Event unavailable"), element("p", "", "The BOTPass contract is not available."));
      return;
    }
    container.setAttribute("aria-busy", "true");
    container.append(element("p", "detail-loading", "Loading event…"));
    let event;
    let passAddedAt = 0n;
    try {
      event = await readEventFromContract(readContract, eventId);
      if (wallet.account) {
        passAddedAt = BigInt(await readContract.claimedAt(event.id, wallet.account));
      }
      if (generation !== routeRenderGeneration) return;
      container.replaceChildren();
    } catch (error) {
      if (generation !== routeRenderGeneration) return;
      container.replaceChildren(
        element("h1", "", "Event unavailable"),
        element("p", "", "Event details could not be loaded. Refresh to retry.")
      );
      throw error;
    } finally {
      if (generation === routeRenderGeneration) {
        container.setAttribute("aria-busy", "false");
      }
    }
    const availability = getEventAvailability(event, now);
    scheduleLifecycleRefresh([event], now);
    const hasPass = passAddedAt > 0n;
    const action = getPassActionState({
      availability,
      hasPass,
      writesEnabled: FRONTEND_CONFIG.writesEnabled,
    });
    const head = element("div", "detail-head");
    const heading = element("div");
    heading.append(
      element("p", "eyebrow", `EVENT #${event.id}`),
      element("h1", "", toPublicEventCopy(event.name)),
      element("p", "lead", toPublicEventCopy(event.description))
    );
    head.append(heading, availabilityIndicator(availability));
    const facts = element("dl", "facts");
    facts.append(fact("Organizer", shortAddress(event.organizer)), fact("Location", toPublicEventCopy(event.location)), fact("Starts", formatDate(event.startTime)), fact("Ends", formatDate(event.endTime)), fact("Passes issued", event.passCount.toString()));
    const attendeePanel = element("div", "event-action-panel");
    const attendeeCopy = element("div");
    attendeeCopy.append(
      element("h2", "", hasPass ? "Pass added" : "Get your event pass"),
      element(
        "p",
        "action-note",
        hasPass
          ? `This wallet added its pass on ${formatDate(passAddedAt)}.`
          : action.reason
      )
    );
    const getPass = element("button", "button primary", action.label);
    getPass.type = "button";
    getPass.disabled = action.disabled;
    getPass.addEventListener("click", async () => {
      try {
        const contract = await requireWriteContract();
        await transact("Get pass", () => contract.claimOpen(event.id), () => renderRoute());
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
          await transact(label, () => contract.setClaimOpen(event.id, !event.claimOpen), () => renderRoute());
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
    const generation = ++routeRenderGeneration;
    const route = showRoute();
    if (lifecycleTimer !== null) {
      clearTimeout(lifecycleTimer);
      lifecycleTimer = null;
    }
    const timedRoute = ["home", "manage", "event"].includes(route.name);
    const now = timedRoute && readProvider
      ? await readLatestBlockTimestamp(readProvider)
      : null;
    if (generation !== routeRenderGeneration) return;
    if (route.name === "home") await renderHome(now, generation);
    if (route.name === "manage") await renderManage(now, generation);
    if (route.name === "passes") await renderPasses(generation);
    if (route.name === "event") await renderEvent(route.eventId, now, generation);
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
              ? `${shortAddress(getAddress(walletAddress))} added a pass for ${toPublicEventCopy(details.name)} on ${formatDate(claimedAt)}.`
              : `${shortAddress(getAddress(walletAddress))} does not have a pass for ${toPublicEventCopy(details.name)}.`
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
        setWalletMenu(false, { restoreFocus: true });
        setStatus("Wallet address copied.");
      } catch (error) { showError(error); }
    });
    document.querySelector("#switch-wallet-button").addEventListener("click", () => switchAccount().catch(showError));
    document.querySelector("#disconnect-wallet-button").addEventListener("click", () => disconnect().catch(showError));
    document.addEventListener("click", (event) => {
      if (!control.contains(event.target)) setWalletMenu(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
        setWalletMenu(false, { restoreFocus: true });
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
        const refreshWallet = createWalletRefreshHandler({
          isDisconnected: isWalletDisconnected,
          clear: clearConnectedWallet,
          read: () => readWalletSnapshot(),
          apply: (snapshot) => {
            Object.assign(wallet, snapshot);
            updateWallet();
          },
          render: renderRoute,
          onError: showError,
        });
        bindWalletEvents({
          onAccountsChanged: refreshWallet,
          onChainChanged: refreshWallet,
        });
      } catch (error) {
        banner.dataset.state = "pending";
        document.querySelector("#deployment-title").textContent = "BOT Chain RPC unavailable";
        document.querySelector("#deployment-message").textContent = "Contract data could not be loaded. Refresh to retry.";
        showError(error);
      }
      updateWallet();
    }
    try {
      await renderRoute();
    } catch (error) {
      showError(error);
    }
  }

  return { initialize, renderRoute };
}
