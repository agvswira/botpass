"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CONTRACT_PATH = "contracts/BOTPass.sol";
const REQUIRED_PATHS = Object.freeze([
  CONTRACT_PATH,
  "frontend/index.html",
  "frontend/src/abi/BOTPass.json",
  "frontend/src/pass/controller.mjs",
  "frontend/src/pass/routing.mjs",
  "package.json",
  "README.md",
]);
const PROTECTED_LOCAL_DOCUMENTS = Object.freeze([
  "docs/bot-chain-developer-documentation.md",
  "docs/hackathon-guidebook-botchain-build-week.md",
]);
const AMBIGUOUS_PATH = /(^|[/_.-])(v1|v2|legacy|passport)(?=$|[/_.-])/i;
const TEXT_EXTENSION = /\.(?:c?js|mjs|json|md|html|css|sol|ya?ml|toml|txt)$/i;
const AMBIGUOUS_PRODUCT_COPY = Object.freeze([
  /\bBOTPass\s*V[12]\b/i,
  /\blegacy\b/i,
  /\bpassport\b/i,
]);
const REMOVED_PROTOCOL_COPY = Object.freeze([
  /claimWithSession/,
  /SignedSession/,
  /QR Claim/,
  /tokenURI/,
]);

function listTrackedFiles(projectRoot) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return output.split("\0").filter(Boolean).sort();
}

function isProductText(relativePath) {
  if (!TEXT_EXTENSION.test(relativePath)) return false;
  return (
    relativePath === "README.md" ||
    relativePath === "package.json" ||
    relativePath.startsWith("docs/") ||
    relativePath.startsWith("frontend/") ||
    relativePath.startsWith("config/events/")
  );
}

function validateRepositoryShape(projectRoot = path.resolve(__dirname, "..")) {
  const trackedFiles = listTrackedFiles(projectRoot);
  const internalDocuments = trackedFiles.filter(
    (relativePath) =>
      relativePath.startsWith(".superpowers/") ||
      relativePath.startsWith("docs/superpowers/")
  );
  if (internalDocuments.length) {
    throw new Error(
      `internal development documents must not be tracked: ${internalDocuments.join(
        ", "
      )}`
    );
  }

  const trackedProtectedDocuments = trackedFiles.filter((relativePath) =>
    PROTECTED_LOCAL_DOCUMENTS.includes(relativePath)
  );
  if (trackedProtectedDocuments.length) {
    throw new Error(
      `protected reference documents must remain untracked: ${trackedProtectedDocuments.join(
        ", "
      )}`
    );
  }

  const ambiguousPaths = trackedFiles.filter((relativePath) =>
    AMBIGUOUS_PATH.test(relativePath)
  );
  if (ambiguousPaths.length) {
    throw new Error(
      `ambiguous tracked path: ${ambiguousPaths.join(", ")}`
    );
  }

  const contracts = trackedFiles.filter((relativePath) =>
    relativePath.startsWith("contracts/") && relativePath.endsWith(".sol")
  );
  if (contracts.length !== 1 || contracts[0] !== CONTRACT_PATH) {
    throw new Error(
      `repository must track exactly ${CONTRACT_PATH}; found ${contracts.join(", ")}`
    );
  }

  const missing = REQUIRED_PATHS.filter(
    (relativePath) => !trackedFiles.includes(relativePath)
  );
  if (missing.length) {
    throw new Error(`canonical repository path is missing: ${missing.join(", ")}`);
  }

  const ambiguousCopy = [];
  for (const relativePath of trackedFiles.filter(isProductText)) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
    if (AMBIGUOUS_PRODUCT_COPY.some((pattern) => pattern.test(source))) {
      ambiguousCopy.push(relativePath);
    }
  }
  if (ambiguousCopy.length) {
    throw new Error(
      `ambiguous product language: ${ambiguousCopy.join(", ")}`
    );
  }
  const removedProtocolCopy = [];
  for (const relativePath of trackedFiles.filter(isProductText)) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
    if (REMOVED_PROTOCOL_COPY.some((pattern) => pattern.test(source))) {
      removedProtocolCopy.push(relativePath);
    }
  }
  if (removedProtocolCopy.length) {
    throw new Error(`removed QR/NFT protocol language: ${removedProtocolCopy.join(", ")}`);
  }

  return {
    trackedFiles: trackedFiles.length,
    contractPath: CONTRACT_PATH,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(validateRepositoryShape(), null, 2));
}

module.exports = { validateRepositoryShape };
