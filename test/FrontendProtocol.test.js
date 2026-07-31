"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { expect } = require("chai");

const projectRoot = path.resolve(__dirname, "..");
const importModule = (relativePath) =>
  import(pathToFileURL(path.join(projectRoot, relativePath)).href);

describe("BOTPass frontend protocol", function () {
  it("maps only the menu-based Open Claim routes", async function () {
    const { parseRoute, routeUrl } = await importModule("frontend/src/pass/routing.mjs");
    for (const name of ["create", "manage", "passes", "verify", "guide"]) {
      expect(parseRoute(`?${name}`)).to.deep.equal({ name });
      expect(routeUrl({ name })).to.equal(`./?${name}`);
    }
    expect(parseRoute("")).to.deep.equal({ name: "home" });
    expect(parseRoute("?event=42")).to.deep.equal({ name: "event", eventId: 42n });
    expect(routeUrl({ name: "event", eventId: 42n })).to.equal("./?event=42");
  });

  it("rejects invalid event IDs and ignores removed QR/pass routes", async function () {
    const { parseRoute } = await importModule("frontend/src/pass/routing.mjs");
    for (const search of ["?event=0", "?event=01", "?event=-1", "?event=abc", "?claim=data", "?pass=9"]) {
      expect(parseRoute(search), search).to.deep.equal({ name: "home" });
    }
  });

  it("gives a valid event route precedence over menu flags", async function () {
    const { parseRoute } = await importModule("frontend/src/pass/routing.mjs");
    expect(parseRoute("?event=7&create&guide")).to.deep.equal({ name: "event", eventId: 7n });
  });
});
