import { Contract, JsonRpcProvider } from "ethers";
import BOTPASS_ABI from "./abi/BOTPass.json" with { type: "json" };
import {
  BOT_CHAIN_ID,
  getActiveBotChain,
  requireDeployment,
} from "./networks.js";
import { verifyRemoteChainId } from "./rpc-validation.mjs";

export const PUBLIC_INDEX_LIMIT = 100;
export const PUBLIC_RPC_CONCURRENCY = 8;

async function mapWithConcurrency(values, mapper, concurrency = PUBLIC_RPC_CONCURRENCY) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

export async function createPublicReadProvider() {
  const network = getActiveBotChain();
  await verifyRemoteChainId(network.rpcUrl, network.chainId);
  return new JsonRpcProvider(network.rpcUrl, network.chainId, {
    staticNetwork: true,
  });
}

export async function requireProviderChain(
  provider,
  expectedChainId = BOT_CHAIN_ID
) {
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== expectedChainId) {
    throw new Error(
      `Connected provider is on Chain ID ${chainId}, expected ${expectedChainId}`
    );
  }
  return chainId;
}

export function getReadContract(provider, chainId = BOT_CHAIN_ID) {
  const deployment = requireDeployment(chainId);
  return new Contract(
    deployment.contractAddress,
    BOTPASS_ABI,
    provider
  );
}

export async function getWriteContract(browserProvider) {
  await requireProviderChain(browserProvider);
  return getReadContract(await browserProvider.getSigner());
}

export async function readEventFromContract(contract, eventId) {
  const details = await contract["getEvent(uint256)"](eventId);
  return {
    id: BigInt(eventId),
    organizer: details.organizer,
    name: details.name,
    description: details.description,
    location: details.location,
    startTime: details.startTime,
    endTime: details.endTime,
    claimOpen: details.claimOpen,
    passCount: details.passCount,
  };
}

export async function readLatestEventIdsFromContract(
  contract,
  limit = PUBLIC_INDEX_LIMIT
) {
  const countValue = await contract.eventCount();
  const count = BigInt(countValue);
  const take = count < BigInt(limit) ? Number(count) : limit;
  return Array.from(
    { length: take },
    (_, offset) => count - BigInt(offset)
  );
}

export async function readOrganizerEventsFromContract(
  contract,
  organizer,
  limit = PUBLIC_INDEX_LIMIT
) {
  const normalized = organizer.toLowerCase();
  const events = await readLatestEventsFromContract(contract, limit);
  return events.filter((event) => event.organizer.toLowerCase() === normalized);
}

export async function readLatestEventsFromContract(
  contract,
  limit = PUBLIC_INDEX_LIMIT
) {
  const ids = await readLatestEventIdsFromContract(contract, limit);
  return mapWithConcurrency(ids, (eventId) =>
    readEventFromContract(contract, eventId)
  );
}

export async function readWalletPassesFromContract(
  contract,
  address,
  limit = PUBLIC_INDEX_LIMIT
) {
  const ids = await readLatestEventIdsFromContract(contract, limit);
  const claims = await mapWithConcurrency(
    ids,
    async (eventId) => ({
      eventId,
      claimedAt: await contract.claimedAt(eventId, address),
    })
  );
  const claimed = claims.filter(({ claimedAt }) => BigInt(claimedAt) > 0n);
  return mapWithConcurrency(
    claimed,
    async ({ eventId, claimedAt }) => ({
      eventId,
      claimedAt: BigInt(claimedAt),
      attendee: address,
      event: await readEventFromContract(contract, eventId),
    })
  );
}

export async function readEventCount(provider) {
  return getReadContract(provider).eventCount();
}

export async function readEvent(provider, eventId) {
  return readEventFromContract(getReadContract(provider), eventId);
}

export async function readOrganizerEvents(provider, organizer, limit) {
  return readOrganizerEventsFromContract(
    getReadContract(provider),
    organizer,
    limit
  );
}

export async function readWalletPasses(provider, address, limit) {
  return readWalletPassesFromContract(
    getReadContract(provider),
    address,
    limit
  );
}

export async function readLatestBlockTimestamp(provider) {
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("Latest chain block is unavailable");
  return BigInt(block.timestamp);
}

export { BOTPASS_ABI };
