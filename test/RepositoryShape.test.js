"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { expect } = require("chai");
const {
  validateRepositoryShape,
} = require("../scripts/validate-repository-shape");

function writeFixture(root, relativePath, source) {
  const outputPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, source);
}

function createRepository(extraFiles = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "botpass-shape-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.name", "BOTPass Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@botpass.invalid"], {
    cwd: root,
  });

  const files = {
    "contracts/BOTPass.sol":
      "// SPDX-License-Identifier: MIT\npragma solidity 0.8.20;\ncontract BOTPass {}\n",
    "frontend/index.html":
      "<!doctype html><title>BOTPass</title><h1>BOTPass</h1><a href='?passes=0x1'>My Passes</a>\n",
    "frontend/src/abi/BOTPass.json": "[]\n",
    "frontend/src/pass/routing.mjs":
      "export const explorerApi = 'https://scan.example/api/v2/';\n",
    "frontend/src/pass/controller.mjs":
      "export const product = 'Open Claim';\n",
    "frontend/public/assets/botpass-mark.svg": "<svg></svg>\n",
    "package.json":
      '{"name":"botpass","scripts":{"test":"hardhat test"}}\n',
    "README.md": "# BOTPass\n\nCreate Event, Claim Pass, and Verify Pass.\n",
    ...extraFiles,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    writeFixture(root, relativePath, source);
  }
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}

function removeRepository(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("BOTPass repository shape", function () {
  it("accepts one canonical contract and responsibility-based paths", function () {
    const cleanRoot = createRepository();
    try {
      expect(validateRepositoryShape(cleanRoot)).to.include({
        contractPath: "contracts/BOTPass.sol",
      });
      expect(validateRepositoryShape(cleanRoot).trackedFiles).to.be.greaterThan(
        0
      );
    } finally {
      removeRepository(cleanRoot);
    }
  });

  it("rejects an ambiguous tracked path", function () {
    const versionedPathRoot = createRepository({
      "frontend/src/v2/compatibility.mjs": "export const enabled = true;\n",
    });
    try {
      expect(() => validateRepositoryShape(versionedPathRoot)).to.throw(
        "ambiguous tracked path"
      );
    } finally {
      removeRepository(versionedPathRoot);
    }
  });

  it("rejects ambiguous product language", function () {
    const ambiguousCopyRoot = createRepository({
      "frontend/index.html": [
        "<!doctype html><h1>BOTPass V",
        "2 Pass",
        "port</h1>\n",
      ].join(""),
    });
    try {
      expect(() => validateRepositoryShape(ambiguousCopyRoot)).to.throw(
        "ambiguous product language"
      );
    } finally {
      removeRepository(ambiguousCopyRoot);
    }
  });

  it("rejects tracked internal development documents", function () {
    const trackedInternalDocsRoot = createRepository({
      ".superpowers/implementation-plan.md": "Internal plan\n",
    });
    try {
      expect(() => validateRepositoryShape(trackedInternalDocsRoot)).to.throw(
        "internal development documents must not be tracked"
      );
    } finally {
      removeRepository(trackedInternalDocsRoot);
    }
  });

  it("rejects removed QR protocol language", function () {
    const obsoleteRoot = createRepository({
      "frontend/index.html": "<!doctype html><h1>QR Claim</h1>\n",
    });
    try {
      expect(() => validateRepositoryShape(obsoleteRoot)).to.throw(
        "removed QR/NFT protocol language"
      );
    } finally {
      removeRepository(obsoleteRoot);
    }
  });
});
