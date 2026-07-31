# BOTPass

BOTPass is a compact, fully functional Open Claim event registry for BOT Chain.

An organizer creates an event and controls whether claims are open. During the event window, each wallet can claim once. The contract stores the claim timestamp and an event-level pass count so anyone can verify attendance without relying on a private database.

## Contract flow

1. `createEvent(name, description, location, startTime, endTime)` creates an immutable event with claims closed.
2. `setClaimOpen(eventId, true)` lets that event's organizer open claims.
3. `claimOpen(eventId)` records the caller's timestamp once.
4. `claimedAt(eventId, wallet)` verifies a claim; zero means no claim exists.
5. `getEvent(eventId)` returns the event, organizer, claim state, and pass count.

There is no QR session, NFT, token ID, metadata renderer, or on-chain index array. The frontend discovers and filters the latest 100 event IDs.

## Networks

| Purpose | Chain | Chain ID | Deployer |
|---|---|---:|---|
| Interactive demo | BOT Chain Testnet | 968 | `0xe604829a9c327b0d924718CfAcEF69BBdC8C0Efc` |
| Hackathon submission | BOT Chain Mainnet | 677 | `0x1396483BFA097Da425658eDef1fdD373D66Be224` |

The Mainnet workflow deploys the same functional bytecode but does not create, open, or claim an event. The Mainnet address will be added after deployment.

Fresh Testnet contract: [`0x2ea9E965433D8f42F9C0caa8BC223335f8e14f6C`](https://scan.bohr.life/address/0x2ea9E965433D8f42F9C0caa8BC223335f8e14f6C)

## Local development

```bash
npm install
npm test
npm run integration:local
npm run frontend:build
npm run frontend:validate
npm run frontend:validate:a11y
```

Use `npm run deploy:testnet:inspect` or `npm run deploy:mainnet:inspect` for transaction-free inspection. Authorized deployment requires the matching private-key environment variable and an exact interactive confirmation phrase.

The deployment guard rejects estimates above 1,400,000 gas. On Mainnet it also rejects any current fee estimate whose maximum cost plus a 25% buffer exceeds the complete 0.0389 BOT budget.

## Web documentation

The public interface includes an English **How It Works** page that follows the product menu: Events, Create, Manage, Open Claim, My Passes, and Verify.

License: MIT.
