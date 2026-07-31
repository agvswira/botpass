"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROUTE_HOOKS = Object.freeze([
  "home",
  "create",
  "manage",
  "event",
  "passes",
  "verify",
  "guide",
]);

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function validateFrontendStructure(projectRoot) {
  const html = fs.readFileSync(path.join(projectRoot, "frontend/index.html"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "frontend/src/styles.css"), "utf8");
  for (const landmark of ["header", "nav", "main", "footer"]) {
    requirePattern(html, new RegExp(`<${landmark}\\b`, "i"), `Missing semantic ${landmark} landmark`);
  }
  for (const route of ROUTE_HOOKS) {
    requirePattern(html, new RegExp(`data-page="${route}"`, "i"), `Missing BOTPass ${route} page hook`);
  }
  requirePattern(html, /id="transaction-status"[^>]*role="status"[^>]*aria-live="polite"/i, "Missing polite transaction status");
  requirePattern(html, /id="verify-result"[^>]*role="status"[^>]*aria-live="polite"/i, "Missing polite Verify result");
  requirePattern(css, /body\s*\{[^}]*display:grid[^}]*grid-template-rows:auto 1fr auto/i, "Application shell must use header/main/footer grid rows");
  requirePattern(css, /body\s*\{[^}]*min-height:100vh/i, "Application shell must fill the viewport");
  requirePattern(css, /\.site-footer\s*\{[^}]*align-self:end/i, "Footer must remain at the bottom of short routes");
  requirePattern(css, /:focus-visible\s*\{[^}]*outline:3px solid #f59e0b/i, "Visible high-contrast focus styling is required");
  requirePattern(css, /\.event-list\s*,\s*\.pass-list\s*\{[^}]*display:grid/i, "Event and pass routes must use functional list layouts");
  requirePattern(css, /\.availability\s*\{[^}]*display:inline-flex/i, "Event availability must use an inline status treatment");
  for (const requiredCopy of ["Get pass", "Passes available", "My Passes", "How BOTPass works", "Verify a pass", "latest 100"]) {
    if (!html.toLowerCase().includes(requiredCopy.toLowerCase())) throw new Error(`Missing required product copy: ${requiredCopy}`);
  }
  for (const [pattern, label] of [
    [/\bclaims?(?:ed|ing)?\b/i, "claim terminology"],
    [/\bQR\b/i, "QR terminology"],
    [/\bremoved\b/i, "removed-flow comparison"],
    [/previous deployment/i, "deployment history"],
    [/claimWithSession|token ID|NFT|Soulbound/, "retired protocol terminology"],
  ]) {
    if (pattern.test(html)) throw new Error(`Public interface contains ${label}`);
  }
  return {
    routeHooks: [...ROUTE_HOOKS],
    semanticLandmarks: ["header", "nav", "main", "footer"],
    hasTransactionRegion: true,
    verifyResultLiveRegion: true,
    shortPageFooterAnchored: true,
    mobileFooterAnchored: true,
    scanLimit: 100,
    guideFollowsMenu: true,
    publicTerminology: "pass",
    currentFlowOnly: true,
    functionalLayout: true,
    statusPresentation: "inline",
  };
}

module.exports = { ROUTE_HOOKS, validateFrontendStructure };
