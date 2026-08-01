# BOTPass

BOTPass is an on-chain event attendance-pass registry on BOT Chain: organizers create events and control availability, attendees record one pass per wallet, and anyone can verify it.

**Live site:** [botpass.online](https://botpass.online/)

**Mainnet contract:** [`0x41fc0234A8f94482168B063FDE7ABE67043E68A4`](https://scan.botchain.ai/address/0x41fc0234A8f94482168B063FDE7ABE67043E68A4) on BOT Chain Mainnet (chain ID 677), with fully verified source code on BOTScan.

## Product flow

- **Events** — browse events and select **Get pass** while passes are available.
- **Create** — create an event from an organizer wallet.
- **Manage** — organizers enable or pause passes for their own events.
- **My Passes** — view passes recorded for the connected wallet.
- **Verify** — check whether a wallet has a pass for an event.

## Contract flow

1. `createEvent(name, description, location, startTime, endTime)` creates an event with passes paused.
2. `setClaimOpen(eventId, true)` enables pass availability for that event; its organizer can also pause it.
3. When an attendee chooses **Get pass**, `claimOpen(eventId)` records one attendance pass for that wallet.
4. `claimedAt(eventId, wallet)` returns the recorded time; zero means the wallet has no pass for the event.
5. `getEvent(eventId)` returns the event data, organizer, availability, and pass count.

## Networks and evidence

The Mainnet deployment's confirmed receipt, compiler settings, and exact runtime-bytecode evidence are committed in [`deployments/677.json`](deployments/677.json). No event was created and no contract function was exercised on Mainnet after deployment.

The Testnet preview contract is [`0x2ea9E965433D8f42F9C0caa8BC223335f8e14f6C`](https://scan.bohr.life/address/0x2ea9E965433D8f42F9C0caa8BC223335f8e14f6C) on BOT Chain Testnet (chain ID 968). Its deployment receipt is committed in [`deployments/968.json`](deployments/968.json); Event ID 1 creation and pass-availability receipt evidence are committed in [`deployments/968-demo.json`](deployments/968-demo.json).

Production builds use the reviewed Mainnet deployment by default. To generate the Testnet preview explicitly, set `BOTPASS_FRONTEND_ENVIRONMENT=staging` when running the frontend generation or build command.

## Local verification

Requires Node.js 24 (see [`.nvmrc`](.nvmrc)). Install the exact dependency versions from the committed lockfile, then run every verification gate:

```bash
npm ci
npm test
npm run integration:local
npm run frontend:build
npm run frontend:validate
npm run frontend:validate:a11y
npm run frontend:validate:dist
npm run repository:validate
```

Copy [`.env.example`](.env.example) to `.env` only when running network preflight or deployment commands. Keep deployer keys local; `.env` files are ignored by Git.

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

License: MIT.
