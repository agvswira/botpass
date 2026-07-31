import { FRONTEND_CONFIG } from "./contract-config.js";

export const BOT_CHAIN_ID = FRONTEND_CONFIG.chainId;
export const BOT_CHAIN_ID_HEX = FRONTEND_CONFIG.chainIdHex;

export function normalizeChainId(chainId) {
  try {
    return Number(BigInt(chainId));
  } catch {
    return null;
  }
}

export function getActiveBotChain() {
  return FRONTEND_CONFIG;
}

export function hasActiveDeployment() {
  return (
    FRONTEND_CONFIG.status === "active" &&
    Boolean(FRONTEND_CONFIG.contractAddress)
  );
}

export function requireDeployment(chainId = BOT_CHAIN_ID) {
  const normalized = normalizeChainId(chainId);
  if (normalized !== BOT_CHAIN_ID) {
    throw new Error(
      `BOTPass is configured for Chain ID ${BOT_CHAIN_ID}, not ${chainId}`
    );
  }
  if (!hasActiveDeployment()) {
    throw new Error(
      `BOTPass is not available on ${FRONTEND_CONFIG.networkName} yet`
    );
  }
  return FRONTEND_CONFIG;
}

export function getWalletAddParameters(network = FRONTEND_CONFIG) {
  return {
    chainId: network.chainIdHex,
    chainName: network.networkName,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: [network.rpcUrl],
    blockExplorerUrls: [network.explorerUrl],
  };
}

export function isActiveBotChain(chainId) {
  return normalizeChainId(chainId) === BOT_CHAIN_ID;
}

export { FRONTEND_CONFIG };
