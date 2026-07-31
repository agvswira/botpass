const RECEIPT_TIMEOUT_MS = 90_000;

function technicalMessage(error) {
  return String(
    error?.shortMessage ||
      error?.reason ||
      error?.message ||
      "The transaction failed."
  ).slice(0, 800);
}

export function classifyTransactionError(error) {
  const code = error?.code ?? error?.info?.error?.code;
  const technical = technicalMessage(error);
  if (code === 4001 || code === "ACTION_REJECTED") {
    return {
      phase: "rejected",
      message: "The wallet request was rejected.",
      technical,
    };
  }
  if (code === "TIMEOUT" || /timeout|timed out/i.test(technical)) {
    return {
      phase: "unknown",
      message:
        "Receipt status is unknown. Check the explorer before trying again.",
      technical,
    };
  }
  return {
    phase: "failed",
    message:
      error?.receipt?.status === 0
        ? "The transaction receipt reported failure."
        : "The transaction failed and no success was recorded.",
    technical,
  };
}

function emit(onStatus, update) {
  onStatus?.(update);
}

function canonicalUnknown({ error, hash, receipt }) {
  return {
    phase: "unknown",
    hash: receipt.hash ?? hash,
    receipt,
    message:
      "The receipt succeeded, but canonical contract state could not confirm the change.",
    technical: error ? technicalMessage(error) : null,
  };
}

export async function executeTransaction({
  send,
  reread,
  isConfirmed,
  onStatus,
  timeoutMs = RECEIPT_TIMEOUT_MS,
}) {
  let hash = null;
  try {
    emit(onStatus, { phase: "awaiting", hash: null });
    const transaction = await send();
    hash = transaction.hash;
    emit(onStatus, { phase: "submitted", hash });
    emit(onStatus, { phase: "waiting", hash });

    let receipt;
    try {
      receipt = await transaction.wait(1, timeoutMs);
    } catch (error) {
      if (
        error?.code === "TRANSACTION_REPLACED" &&
        !error.cancelled &&
        error.receipt?.status === 1
      ) {
        receipt = error.receipt;
        hash = error.replacement?.hash ?? error.receipt.hash ?? hash;
      } else {
        throw error;
      }
    }

    if (!receipt) {
      const unknown = {
        phase: "unknown",
        hash,
        receipt: null,
        message:
          "Receipt status is unknown. Check the explorer before trying again.",
      };
      emit(onStatus, unknown);
      return unknown;
    }
    if (receipt.status !== 1) {
      const error = new Error("The transaction receipt reported failure");
      error.receipt = receipt;
      throw error;
    }

    let canonicalState;
    try {
      canonicalState = await reread({ hash: receipt.hash ?? hash, receipt });
      if (
        !isConfirmed(canonicalState, {
          hash: receipt.hash ?? hash,
          receipt,
        })
      ) {
        const unknown = canonicalUnknown({ hash, receipt });
        emit(onStatus, unknown);
        return unknown;
      }
    } catch (error) {
      const unknown = canonicalUnknown({ error, hash, receipt });
      emit(onStatus, unknown);
      return unknown;
    }
    const confirmed = {
      phase: "confirmed",
      hash: receipt.hash ?? hash,
      receipt,
      state: canonicalState,
      message: "Confirmed from canonical contract state.",
    };
    emit(onStatus, confirmed);
    return confirmed;
  } catch (error) {
    const classified = classifyTransactionError(error);
    const update = { ...classified, hash: error.transactionHash ?? hash };
    emit(onStatus, update);
    if (classified.phase === "unknown") return update;
    error.transactionState = update;
    throw error;
  }
}

export { RECEIPT_TIMEOUT_MS };
