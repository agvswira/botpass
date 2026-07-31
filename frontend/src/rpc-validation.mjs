export async function verifyRemoteChainId(
  rpcUrl,
  expectedChainId,
  { fetchImpl = fetch } = {}
) {
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    });
  } catch {
    throw new Error("Configured BOT Chain RPC is unavailable");
  }
  if (!response.ok) {
    throw new Error(`Configured BOT Chain RPC returned HTTP ${response.status}`);
  }
  const body = await response.json();
  if (
    body?.jsonrpc !== "2.0" ||
    body.id !== 1 ||
    typeof body.result !== "string" ||
    body.error !== undefined ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(body.result)
  ) {
    throw new Error("Configured BOT Chain RPC returned an invalid eth_chainId");
  }
  const observed = Number(BigInt(body.result));
  if (observed !== expectedChainId) {
    throw new Error(
      `Configured BOT Chain RPC returned Chain ID ${observed}, expected ${expectedChainId}`
    );
  }
  return observed;
}
