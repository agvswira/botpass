"use strict";

const FRONTEND_ACTIVATIONS = Object.freeze({
  production: Object.freeze({
    enabled: true,
    reviewed: true,
    chainId: 677,
    contractAddress: "0x41fc0234A8f94482168B063FDE7ABE67043E68A4",
    deploymentTransactionHash:
      "0xb86877c47c9b6b937f0142245d2c6e9083ed73e87d5b36b063d0624f43a7105f",
  }),
  staging: Object.freeze({
    enabled: true,
    reviewed: true,
    chainId: 968,
    contractAddress: "0x2ea9E965433D8f42F9C0caa8BC223335f8e14f6C",
    deploymentTransactionHash:
      "0x019995d38fd45d2e29f9b725255df823130be0768ec7ce0c87abb1c7cc1f5d10",
  }),
});

module.exports = { FRONTEND_ACTIVATIONS };
