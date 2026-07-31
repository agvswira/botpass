"use strict";

// Mainnet remains read-only and pending until the hackathon deployment.
const FRONTEND_ACTIVATIONS = Object.freeze({
  production: null,
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
