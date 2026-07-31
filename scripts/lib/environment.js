"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadProjectEnvironment(projectRoot) {
  const envPath = path.join(projectRoot, ".env");

  if (!fs.existsSync(envPath)) {
    return false;
  }

  process.loadEnvFile(envPath);
  return true;
}

module.exports = {
  loadProjectEnvironment,
};
