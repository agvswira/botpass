import { BrowserProvider } from "ethers";
import {
  getActiveBotChain,
  getWalletAddParameters,
  normalizeChainId,
} from "./networks.js";

let boundProvider = null;
let boundHandlers = null;

function defaultHost() {
  return typeof window === "undefined" ? globalThis : window;
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
