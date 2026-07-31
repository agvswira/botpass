async function requestWithPending({
  wallet,
  request,
  onPendingChange = () => {},
}) {
  wallet.pending = true;
  onPendingChange();
  try {
    const snapshot = await request();
    if (snapshot && typeof snapshot === "object") {
      Object.assign(wallet, snapshot);
    }
    return snapshot;
  } finally {
    wallet.pending = false;
    onPendingChange();
  }
}

export function requestWalletConnection(options) {
  return requestWithPending(options);
}

export function requestWalletSwitch(options) {
  return requestWithPending(options);
}
