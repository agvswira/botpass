"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateFrontendStructure } = require("./lib/frontend-structure");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "frontend/index.html"), "utf8");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicates.length) throw new Error(`Duplicate HTML IDs: ${duplicates.join(", ")}`);
for (const [pattern, message] of [
  [/<html\s+lang="en"/i, "Document language must be English"],
  [/<main\b[^>]*id="main-content"/i, "Semantic main landmark is required"],
  [/<nav\b[^>]*aria-label=/i, "Labeled navigation is required"],
  [/class="skip-link"[^>]*href="#main-content"/i, "Skip link is required"],
  [/<label(?:\s|>)/i, "Form controls require labels"],
]) if (!pattern.test(html)) throw new Error(message);
const buttonsWithoutType = [...html.matchAll(/<button\b([^>]*)>/gi)].filter((match) => !/\btype="(?:button|submit|reset)"/i.test(match[1]));
if (buttonsWithoutType.length) throw new Error("Every button must declare an explicit type");
const structure = validateFrontendStructure(projectRoot);
console.log(JSON.stringify({ documentLanguage: "en", uniqueIds: ids.length, explicitButtonTypes: true, visibleFocusStyles: true, ...structure }, null, 2));
