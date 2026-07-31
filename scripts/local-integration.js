"use strict";

const { ethers } = require("hardhat");
const {
  runLocalIntegration,
} = require("./lib/local-integration");

async function main() {
  const result = await runLocalIntegration({ ethers });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main };
