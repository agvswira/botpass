import { Interface } from "ethers";
import BOTPASS_ABI from "./abi/BOTPass.json" with { type: "json" };

const contractInterface = new Interface(BOTPASS_ABI);

const CONTRACT_MESSAGES = Object.freeze({
  AlreadyClaimed: "This wallet already has a pass for this event.",
  ClaimClosed: "Passes are currently paused by the organizer.",
  EmptyField: "Every event metadata field is required.",
  EndTimeNotFuture: "The event end must be in the future.",
  EventEnded: "This event has ended.",
  EventNotFound: "That BOTPass event does not exist.",
  EventNotStarted: "This event has not started yet.",
  FieldTooLong: "One event metadata field exceeds its on-chain limit.",
  InvalidTimeRange: "The event end must be after its start.",
  UnauthorizedOrganizer: "Only this event’s organizer may change it.",
});

function findRevertData(error) {
  const candidates = [
    error?.data,
    error?.data?.data,
    error?.error?.data,
    error?.error?.data?.data,
    error?.info?.error?.data,
    error?.info?.error?.data?.data,
    error?.info?.error?.error?.data,
    error?.receipt?.revertReason,
  ];
  return candidates.find(
    (value) => typeof value === "string" && value.startsWith("0x")
  );
}

function technicalMessage(error) {
  return String(
    error?.shortMessage ||
      error?.reason ||
      error?.message ||
      "No additional error information is available."
  ).slice(0, 800);
}

function publicFallbackMessage(technical) {
  const internalTerminology = /\bclaims?(?:ed|ing)?\b|claimOpen|claimedAt|\bQR\b|legac[y]|previous deployment|removed flow/i;
  return internalTerminology.test(technical)
    ? "The action could not be completed. Check your wallet and try again."
    : technical;
}

export function describeError(error) {
  const revertData = findRevertData(error);
  if (revertData) {
    try {
      const parsed = contractInterface.parseError(revertData);
      if (parsed && CONTRACT_MESSAGES[parsed.name]) {
        return {
          kind: parsed.name,
          message: CONTRACT_MESSAGES[parsed.name],
          technical: technicalMessage(error),
        };
      }
    } catch {
      // Continue with wallet/provider classification.
    }
  }

  const code = error?.code ?? error?.info?.error?.code;
  const technical = technicalMessage(error);
  const lower = technical.toLowerCase();
  if (typeof code === "string" && CONTRACT_MESSAGES[code]) {
    return { kind: code, message: CONTRACT_MESSAGES[code], technical };
  }
  if (code === 4001 || code === "ACTION_REJECTED") {
    return {
      kind: "rejected",
      message: "The request was rejected in the wallet.",
      technical,
    };
  }
  if (code === "TIMEOUT" || lower.includes("timeout")) {
    return {
      kind: "unknown",
      message:
        "Receipt status is unknown. Check the BOTScan link before retrying.",
      technical,
    };
  }
  if (lower.includes("insufficient funds")) {
    return {
      kind: "insufficientFunds",
      message: "This wallet does not have enough BOT for gas.",
      technical,
    };
  }
  if (lower.includes("network") || lower.includes("rpc")) {
    return {
      kind: "rpc",
      message: "BOT Chain RPC is unavailable. Check the network and retry.",
      technical,
    };
  }
  return {
    kind: "failed",
    message: publicFallbackMessage(technical),
    technical,
  };
}
