"use strict";

const { expect } = require("chai");
const {
  BOTCHAIN_TESTNET,
  getTestnetRpcUrl,
  sanitizeRpcOrigin,
} = require("../config/botchain");

describe("BOT Chain Testnet configuration", function () {
  const originalRpcUrl = process.env.BOTCHAIN_TESTNET_RPC_URL;

  afterEach(function () {
    if (originalRpcUrl === undefined) {
      delete process.env.BOTCHAIN_TESTNET_RPC_URL;
    } else {
      process.env.BOTCHAIN_TESTNET_RPC_URL = originalRpcUrl;
    }
  });

  it("uses the confirmed Testnet metadata and safe RPC fallback", function () {
    delete process.env.BOTCHAIN_TESTNET_RPC_URL;

    expect(BOTCHAIN_TESTNET.networkName).to.equal("BOT Chain Testnet");
    expect(BOTCHAIN_TESTNET.chainId).to.equal(968);
    expect(BOTCHAIN_TESTNET.chainIdHex).to.equal("0x3C8");
    expect(BOTCHAIN_TESTNET.nativeCurrency).to.deep.equal({
      name: "BOT",
      symbol: "BOT",
      decimals: 18,
    });
    expect(BOTCHAIN_TESTNET.intendedDeployer).to.equal(
      "0xe604829a9c327b0d924718CfAcEF69BBdC8C0Efc"
    );
    expect(getTestnetRpcUrl()).to.equal("https://rpc.bohr.life");
    expect(sanitizeRpcOrigin(getTestnetRpcUrl())).to.equal(
      "https://rpc.bohr.life"
    );
  });

  it("uses an optional validated public Testnet RPC override", function () {
    process.env.BOTCHAIN_TESTNET_RPC_URL = "https://example.test/rpc";
    expect(getTestnetRpcUrl()).to.equal("https://example.test/rpc");

    process.env.BOTCHAIN_TESTNET_RPC_URL = "file:///tmp/not-an-rpc";
    expect(() => getTestnetRpcUrl()).to.throw("must use HTTP or HTTPS");
  });
});
