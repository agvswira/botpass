# BOTPass

BOTPass is an on-chain event attendance-pass registry on BOT Chain: organizers create events and control availability, attendees record one pass for each event they attend, and anyone can verify it.

## Project links

- **Live website:** [botpass.online](https://botpass.online/)
- **Mainnet contract:** [`0x41fc0234A8f94482168B063FDE7ABE67043E68A4`](https://scan.botchain.ai/address/0x41fc0234A8f94482168B063FDE7ABE67043E68A4)
- **Source repository:** [github.com/agvswira/botpass](https://github.com/agvswira/botpass)
- **X post:** `...`

## Why BOTPass

Event attendance is often stored in a private list that attendees cannot independently check. BOTPass gives each organizer control over its own events while recording at most one verifiable attendance pass per event for each wallet on BOT Chain. The result can be checked later by anyone using only an Event ID and wallet address.

## How to use

BOTPass works with an injected EVM wallet such as MetaMask or BO Wallet. Select **Connect wallet** and approve the request; the app asks the wallet to add or switch to BOT Chain Mainnet when necessary.

1. **Events** — browse available events, open one, and select **Get pass** during its active time while the organizer has made passes available. Each wallet can get one pass per event.
2. **Create** — connect an organizer wallet, enter the event details and time window, then confirm the transaction. A new event starts with passes paused.
3. **Manage** — use the same organizer wallet to enable or pause passes for events it created. Other wallets cannot change those settings.
4. **My Passes** — connect a wallet to see its recorded passes and the time each one was added.
5. **Verify** — enter an Event ID and wallet address to check whether a pass exists. Verification is read-only and costs no gas.

## Contract flow

1. `createEvent(name, description, location, startTime, endTime)` creates an event with passes paused.
2. `setClaimOpen(eventId, true)` enables pass availability for that event; its organizer can also pause it.
3. When an attendee chooses **Get pass**, `claimOpen(eventId)` records one attendance pass for that wallet.
4. `claimedAt(eventId, wallet)` returns the recorded time; zero means the wallet has no pass for the event.
5. `getEvent(eventId)` returns the event data, organizer, availability, and pass count.

## Networks and evidence

The production contract is deployed on BOT Chain Mainnet and its Solidity source is fully verified on BOTScan.

| Deployment detail | Value |
| --- | --- |
| Network | BOT Chain Mainnet (chain ID 677) |
| Contract | [`0x41fc0234A8f94482168B063FDE7ABE67043E68A4`](https://scan.botchain.ai/address/0x41fc0234A8f94482168B063FDE7ABE67043E68A4) |
| Transaction | [`0xb86877c47c9b6b937f0142245d2c6e9083ed73e87d5b36b063d0624f43a7105f`](https://scan.botchain.ai/tx/0xb86877c47c9b6b937f0142245d2c6e9083ed73e87d5b36b063d0624f43a7105f) |
| Deployer | `0x1396483BFA097Da425658eDef1fdD373D66Be224` |
| Deployed | 2026-08-01 06:37:03 UTC |
| Compiler | Solidity 0.8.20, optimizer enabled with 200 runs |
| Evidence | Transaction metadata, compiler settings, and runtime-bytecode size and hash in [`deployments/677.json`](deployments/677.json) |

No event was created and no contract function was exercised on Mainnet after deployment.

The Testnet preview contract is [`0x2ea9E965433D8f42F9C0caa8BC223335f8e14f6C`](https://scan.bohr.life/address/0x2ea9E965433D8f42F9C0caa8BC223335f8e14f6C) on BOT Chain Testnet (chain ID 968). Its deployment receipt is committed in [`deployments/968.json`](deployments/968.json); Event ID 1 creation and pass-availability receipt evidence are committed in [`deployments/968-demo.json`](deployments/968-demo.json).

Production builds use the reviewed Mainnet deployment by default. To generate the Testnet preview explicitly, set `BOTPASS_FRONTEND_ENVIRONMENT=staging` when running the frontend generation or build command.

## Run locally

Requires Node.js 24 (see [`.nvmrc`](.nvmrc)). Install the exact dependency versions from the committed lockfile and start the Vite development server:

```bash
npm ci
npm run frontend:dev
```

Copy [`.env.example`](.env.example) to `.env` only when running network preflight or deployment commands. Keep deployer keys local; `.env` files are ignored by Git.

## Verify the repository

Run every automated verification gate:

```bash
npm test
npm run integration:local
npm run frontend:build
npm run frontend:validate
npm run frontend:validate:a11y
npm run frontend:validate:dist
npm run repository:validate
```

## Guarded deployment workflow

Offline inspection sends no transaction:

```bash
npm run deploy:testnet:inspect
npm run deploy:mainnet:inspect
```

Live preflight also sends no transaction:

```bash
npm run deploy:testnet:preflight
npm run deploy:mainnet:preflight
```

Deployment requires the matching deployer key and the exact interactive confirmation guard:

```bash
npm run deploy:testnet
npm run deploy:mainnet
```

## Project structure

- [`contracts/BOTPass.sol`](contracts/BOTPass.sol) — canonical Solidity contract.
- [`frontend/`](frontend/) — static Vite application deployed to GitHub Pages.
- [`scripts/`](scripts/) — guarded deployment, verification, generation, and validation tools.
- [`test/`](test/) — contract, deployment-safety, integration, frontend, and repository tests.
- [`deployments/`](deployments/) — immutable deployment and transaction evidence.

The project uses Solidity 0.8.20, ethers.js 6.17.0, Hardhat 2.29.0, and Vite 8.1.5. The frontend is deployed through GitHub Actions to GitHub Pages with the custom domain `botpass.online`.

License: MIT.
