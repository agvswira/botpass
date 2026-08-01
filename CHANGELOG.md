# Changelog

All notable user-facing changes to BOTPass are documented here.

## [0.1.0] - 2026-08-01

### Added

- A fully functional BOT Chain event-pass contract for creating events, controlling pass availability, recording one pass per wallet, and verifying attendance.
- A responsive web interface for browsing events, creating and managing events, viewing wallet passes, and checking a wallet against an Event ID.
- Wallet connection controls with clear network, transaction, empty, loading, and error states.
- Guarded Testnet and Mainnet deployment workflows with gas and balance checks, explicit authorization prompts, and immutable receipt evidence.
- A verified BOT Chain Mainnet deployment at [`0x41fc0234A8f94482168B063FDE7ABE67043E68A4`](https://scan.botchain.ai/address/0x41fc0234A8f94482168B063FDE7ABE67043E68A4).

### Fixed

- Event lists now present Event IDs, time, location, organizer controls, and pass status in a clearer structure.
- The page layout keeps the footer at the bottom across empty, loading, error, and populated views.
- Public event descriptions are normalized so internal protocol terminology does not leak into the interface.
