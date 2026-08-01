import { BrowserProvider } from "ethers";
import {
  getActiveBotChain,
  getWalletAddParameters,
  normalizeChainId,
} from "./networks.js";

let boundProvider = null;
let boundHandlers = null;
const DISCONNECTED_KEY = "botpass.walletDisconnected";

function defaultHost() {
  return typeof window === "undefined" ? globalThis : window;
}

function defaultStorage() {
  try {
    return defaultHost()?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function isWalletDisconnected(storage = defaultStorage()) {
  try {
    return storage?.getItem(DISCONNECTED_KEY) === "true";
  } catch {
    return false;
  }
}

export function markWalletDisconnected(storage = defaultStorage()) {
  try {
    storage?.setItem(DISCONNECTED_KEY, "true");
  } catch {
    // A blocked storage API must not prevent a local disconnect.
  }
}

export function clearWalletDisconnected(storage = defaultStorage()) {
  try {
    storage?.removeItem(DISCONNECTED_KEY);
  } catch {
    // A blocked storage API must not prevent an explicit connection.
  }
}

export function getInjectedProvider(host = defaultHost()) {
  return host?.ethereum ?? null;
}

export function hasInjectedWallet(host = defaultHost()) {
  return Boolean(getInjectedProvider(host)?.request);
}

export function buildMetaMaskMobileLink(currentUrl) {
  const url = new URL(currentUrl);
  const dappPath = `${url.host}${url.pathname}${url.search}${url.hash}`;
  return `https://metamask.app.link/dapp/${dappPath}`;
}

export async function readWalletSnapshot({
  requestAccounts = false,
  provider = getInjectedProvider(),
} = {}) {
  if (!provider?.request) {
    return {
      available: false,
      account: null,
      chainId: null,
      browserProvider: null,
      injectedProvider: null,
    };
  }

  const method = requestAccounts ? "eth_requestAccounts" : "eth_accounts";
  const [accounts, chainIdHex] = await Promise.all([
    provider.request({ method }),
    provider.request({ method: "eth_chainId" }),
  ]);

  return {
    available: true,
    account: accounts[0] ?? null,
    chainId: normalizeChainId(chainIdHex),
    browserProvider: new BrowserProvider(provider, "any"),
    injectedProvider: provider,
  };
}

function isUnknownChainError(error) {
  return (
    error?.code === 4902 ||
    error?.data?.originalError?.code === 4902 ||
    error?.error?.code === 4902
  );
}

export async function switchOrAddBotChain({
  provider = getInjectedProvider(),
  network = getActiveBotChain(),
} = {}) {
  if (!provider?.request) {
    throw new Error("No EIP-1193 wallet provider is available");
  }
  const networkParameters = getWalletAddParameters(network);
  const switchRequest = {
    method: "wallet_switchEthereumChain",
    params: [{ chainId: networkParameters.chainId }],
  };

  try {
    await provider.request(switchRequest);
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [networkParameters],
    });
    await provider.request(switchRequest);
  }

  const snapshot = await readWalletSnapshot({ provider });
  if (snapshot.chainId !== network.chainId) {
    throw new Error(
      `Wallet did not switch to ${network.networkName} (${network.chainId})`
    );
  }
  return snapshot;
}

function isUnsupportedPermissionRequest(error) {
  return error?.code === -32601 || error?.code === 4200;
}

export async function requestWalletAccountSwitch({
  provider = getInjectedProvider(),
} = {}) {
  if (!provider?.request) {
    throw new Error("No EIP-1193 wallet provider is available");
  }

  try {
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch (error) {
    if (!isUnsupportedPermissionRequest(error)) throw error;
    return {
      supported: false,
      snapshot: await readWalletSnapshot({ provider }),
    };
  }

  return {
    supported: true,
    snapshot: await readWalletSnapshot({ provider }),
  };
}

export function createWalletRefreshHandler({
  isDisconnected,
  clear,
  read,
  apply,
  render,
  onError,
}) {
  let generation = 0;

  return async function refreshWallet() {
    if (isDisconnected()) return;
    const currentGeneration = ++generation;
    clear();

    try {
      const snapshot = await read();
      if (currentGeneration !== generation || isDisconnected()) return;
      apply(snapshot);
      await render();
    } catch (error) {
      if (currentGeneration !== generation || isDisconnected()) return;
      clear();
      try {
        await render();
      } catch (renderError) {
        onError(renderError);
        return;
      }
      onError(error);
    }
  };
}

export function bindWalletEvents({
  onAccountsChanged,
  onChainChanged,
  provider = getInjectedProvider(),
}) {
  if (!provider?.on) return () => {};

  if (boundProvider && boundHandlers) {
    boundProvider.removeListener?.(
      "accountsChanged",
      boundHandlers.accountsChanged
    );
    boundProvider.removeListener?.("chainChanged", boundHandlers.chainChanged);
  }

  boundProvider = provider;
  boundHandlers = {
    accountsChanged: (accounts) => onAccountsChanged(accounts),
    chainChanged: (chainId) => onChainChanged(normalizeChainId(chainId)),
  };
  provider.on("accountsChanged", boundHandlers.accountsChanged);
  provider.on("chainChanged", boundHandlers.chainChanged);

  return () => {
    provider.removeListener?.("accountsChanged", boundHandlers.accountsChanged);
    provider.removeListener?.("chainChanged", boundHandlers.chainChanged);
    if (boundProvider === provider) {
      boundProvider = null;
      boundHandlers = null;
    }
  };
}
