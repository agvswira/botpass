"use strict";

const { execFileSync } = require("node:child_process");

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getSourceCommit(cwd) {
  const commit = runGit(["rev-parse", "HEAD"], cwd);
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("Unable to resolve a valid source commit");
  }
  return commit;
}

function assertTrackedSourceClean(deploymentName = "Testnet", cwd) {
  const status = runGit(
    ["status", "--porcelain", "--untracked-files=all"],
    cwd
  );
  if (status) {
    throw new Error(
      `The source tree has staged, unstaged, or untracked changes; commit and review it before ${deploymentName} deployment`
    );
  }
}

function getCompilerSettings(hre) {
  const compiler = hre.config.solidity.compilers[0];
  return {
    compilerVersion: compiler.version,
    evmVersion: compiler.settings.evmVersion,
    optimizerEnabled: compiler.settings.optimizer.enabled,
    optimizerRuns: compiler.settings.optimizer.runs,
  };
}

async function getBytecodeSizes(hre) {
  const artifact = await hre.artifacts.readArtifact("BOTPass");
  return {
    creationBytecodeSize: (artifact.bytecode.length - 2) / 2,
    runtimeBytecodeSize: (artifact.deployedBytecode.length - 2) / 2,
  };
}

module.exports = {
  assertTrackedSourceClean,
  getBytecodeSizes,
  getCompilerSettings,
  getSourceCommit,
};
