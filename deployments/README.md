# Deployment records

The guarded deployment command writes one canonical record per verified deployment:

- `968.json` for the fresh interactive Testnet deployment.
- `968-demo.json` for event-creation and pass-availability receipts on Testnet.
- `677.json` for the reviewed Mainnet deployment after its transaction confirms.

`677.json` is created only after its Mainnet transaction confirms and exact runtime bytecode is verified.
