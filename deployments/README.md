# Deployment records

The guarded deployment command writes one canonical record per deployed network:

- `968.json` for the fresh interactive Testnet deployment.
- `968-demo.json` for the fresh event-creation and open-claims acceptance receipts.
- `677.json` for the functional but unexercised Mainnet submission.

These files do not exist before their corresponding transaction is confirmed and exact runtime bytecode is verified. Historical Testnet deployment records are intentionally excluded.
