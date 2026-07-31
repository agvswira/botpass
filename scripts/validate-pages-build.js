"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "frontend/dist");
const indexPath = path.join(dist, "index.html");
const cnamePath = path.join(dist, "CNAME");
if (!fs.existsSync(indexPath)) throw new Error("Built index.html is missing");
if (!fs.existsSync(cnamePath) || fs.readFileSync(cnamePath, "utf8") !== "botpass.online\n") throw new Error("CNAME must contain exactly botpass.online");

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

const index = fs.readFileSync(indexPath, "utf8");
for (const marker of [
  'rel="canonical" href="https://botpass.online/"',
  "Verifiable event passes",
  "How BOTPass works",
  "My Passes",
]) if (!index.includes(marker)) throw new Error(`Built page is missing ${marker}`);

const builtFiles = files(dist);
const bundle = builtFiles.filter((file) => /\.(html|js|css)$/.test(file)).map((file) => fs.readFileSync(file, "utf8")).join("\n");
for (const marker of ["https://rpc.bohr.life", "https://scan.bohr.life", "getEvent(uint256)", "claimOpen", "claimedAt", "BOT Chain Testnet", "0x2ea9E965433D8f42F9C0caa8BC223335f8e14f6C"]) {
  if (!bundle.includes(marker)) throw new Error(`Built bundle is missing ${marker}`);
}
for (const forbidden of [
  "claimWithSession",
  "api.qrserver.com",
  "BOTPASS_TESTNET_DEPLOYER_PRIVATE_KEY",
  "BOTPASS_MAINNET_DEPLOYER_PRIVATE_KEY",
  "BEGIN PRIVATE KEY",
]) if (bundle.includes(forbidden)) throw new Error(`Built bundle contains forbidden marker: ${forbidden}`);
if (builtFiles.some((file) => path.basename(file).startsWith(".env"))) throw new Error("Environment file included in build");
console.log(JSON.stringify({ customDomain: "botpass.online", environment: "staging", deploymentStatus: "active", openClaimOnly: true, secretMarkerScan: "passed", files: builtFiles.map((file) => path.relative(dist, file)).sort() }, null, 2));
