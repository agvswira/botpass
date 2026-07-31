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
  readWalletSnapshot,
  switchOrAddBotChain,
} from "../wallet.js";
import { parseRoute } from "./routing.mjs";

const formatDate = (value) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(Number(value) * 1000));
const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function eventCard(event, { manage = false } = {}) {
  const card = element("article", "event-card");
  const status = element("span", `status ${event.claimOpen ? "open" : "closed"}`, event.claimOpen ? "Claims open" : "Claims closed");
  const title = element("h3", "", event.name);
  const description = element("p", "", event.description);
  const link = element("a", "", manage ? "Open management →" : "View and claim →");
  link.href = `./?event=${event.id}`;
  const meta = element("div", "meta");
  meta.append(element("span", "", `#${event.id}`), element("span", "", `${event.passCount} passes`));
  card.append(status, title, description, link, meta);
  return card;
}

export function createAppController() {
  const wallet = { account: null, chainId: null, browserProvider: null };
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
    button.textContent = wallet.account ? shortAddress(wallet.account) : "Connect wallet";
  }

  async function connect() {
    if (!hasActiveDeployment()) throw new Error("The fresh Testnet deployment is not active yet.");
    let snapshot = await readWalletSnapshot({ requestAccounts: true });
    if (snapshot.chainId !== FRONTEND_CONFIG.chainId) snapshot = await switchOrAddBotChain();
    Object.assign(wallet, snapshot);
    updateWallet();
    await renderRoute();
    return snapshot;
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
      card.append(
        element("span", "status open", "Claim verified"),
        element("h3", "", pass.event.name),
        element("p", "", `Event #${pass.eventId} · claimed ${formatDate(pass.claimedAt)}`)
      );
      const link = element("a", "", "View event →");
      link.href = `./?event=${pass.eventId}`;
      card.append(link);
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
      container.append(element("h1", "", "Event unavailable"), element("p", "", "The fresh Testnet contract has not been activated yet."));
      return;
    }
    const event = await readEventFromContract(readContract, eventId);
    const head = element("div", "detail-head");
    const heading = element("div");
    heading.append(element("p", "eyebrow", `EVENT #${event.id}`), element("h1", "", event.name), element("p", "lead", event.description));
    head.append(heading, element("span", `status ${event.claimOpen ? "open" : "closed"}`, event.claimOpen ? "Claims open" : "Claims closed"));
    const facts = element("dl", "facts");
    facts.append(fact("Organizer", shortAddress(event.organizer)), fact("Location", event.location), fact("Starts", formatDate(event.startTime)), fact("Ends", formatDate(event.endTime)), fact("Passes", event.passCount.toString()));
    const actions = element("div", "claim-actions");
    const claim = element("button", "button primary", "Claim this event");
    claim.type = "button";
    claim.disabled = !event.claimOpen || !FRONTEND_CONFIG.writesEnabled;
    claim.addEventListener("click", async () => {
      try {
        const contract = await requireWriteContract();
        await transact("Open Claim", () => contract.claimOpen(event.id), () => renderEvent(event.id));
      } catch (error) { showError(error); }
    });
    actions.append(claim);
    if (
      FRONTEND_CONFIG.writesEnabled &&
      wallet.account?.toLowerCase() === event.organizer.toLowerCase()
    ) {
      const toggle = element("button", "button secondary", event.claimOpen ? "Close claims" : "Open claims");
      toggle.type = "button";
      toggle.addEventListener("click", async () => {
        try {
          const contract = await requireWriteContract();
          await transact(event.claimOpen ? "Close claims" : "Open claims", () => contract.setClaimOpen(event.id, !event.claimOpen), () => renderEvent(event.id));
        } catch (error) { showError(error); }
      });
      actions.append(toggle);
    }
    container.append(head, facts, actions);
  }

  async function renderRoute() {
    const route = parseRoute(location.search);
    document.querySelectorAll("[data-page]").forEach((node) => { node.hidden = node.dataset.page !== route.name; });
    document.querySelectorAll("[data-link]").forEach((node) => {
      if (node.matches("nav a")) node.toggleAttribute("aria-current", node.dataset.link === route.name);
    });
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
        if (!readContract) throw new Error("The fresh Testnet contract is not active yet.");
        const data = new FormData(event.currentTarget);
        const eventId = data.get("eventId").trim();
        const walletAddress = data.get("wallet").trim();
        if (!/^[1-9][0-9]*$/.test(eventId) || !isAddress(walletAddress)) throw new Error("Enter a valid event ID and wallet address.");
        const [claimedAt, details] = await Promise.all([readContract.claimedAt(eventId, getAddress(walletAddress)), readEventFromContract(readContract, eventId)]);
        const valid = BigInt(claimedAt) > 0n;
        result.replaceChildren(element("h2", "", valid ? "Attendance verified" : "No claim found"), element("p", "", valid ? `${shortAddress(getAddress(walletAddress))} claimed ${details.name} on ${formatDate(claimedAt)}.` : `${shortAddress(getAddress(walletAddress))} has not claimed ${details.name}.`));
        result.dataset.valid = String(valid);
        result.hidden = false;
      } catch (error) { result.hidden = true; showError(error); }
    });
  }

  async function initialize() {
    const active = hasActiveDeployment();
    const banner = document.querySelector("#deployment-banner");
    banner.dataset.state = active ? "active" : "pending";
    document.querySelector("#deployment-title").textContent = active ? "Live Testnet demo" : "Fresh Testnet deployment pending";
    document.querySelector("#deployment-message").textContent = active ? `Contract ${shortAddress(FRONTEND_CONFIG.contractAddress)} on Chain ${FRONTEND_CONFIG.chainId}.` : "Read and write actions stay disabled until the new Open Claim contract is deployed and reviewed.";
    const contractLink = document.querySelector("#contract-link");
    contractLink.href = active ? `${FRONTEND_CONFIG.explorerUrl}/address/${FRONTEND_CONFIG.contractAddress}` : FRONTEND_CONFIG.explorerUrl;
    document.querySelector("#connect-button").disabled = !active;
    document.querySelector("#create-form button[type=submit]").disabled =
      !FRONTEND_CONFIG.writesEnabled;
    document.querySelector("#connect-button").addEventListener("click", () => connect().catch(showError));
    bindForms();
    if (active) {
      readProvider = await createPublicReadProvider();
      readContract = getReadContract(readProvider);
      Object.assign(wallet, await readWalletSnapshot());
      updateWallet();
      bindWalletEvents({ onAccountsChanged: () => location.reload(), onChainChanged: () => location.reload() });
    }
    await renderRoute();
    setStatus("", true);
  }

  return { initialize, renderRoute };
}
