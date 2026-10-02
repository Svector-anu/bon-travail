# Implementation note

## Current architecture

The repository started empty, so there was nothing to preserve. The stack choices follow the constraints in the brief:

| Concern | Choice | Why |
|---|---|---|
| Web, API | Next.js 16 App Router, React 19, TypeScript | One deployable for pages and route handlers |
| Storage | SQLite through `node:sqlite` (Node 22.13+) | Real transactions, unique constraints and triggers with zero native dependencies |
| Chain | viem against Arc Testnet RPC (chain 5042002) | Typed RPC, log decoding, transaction signing |
| Tests | Vitest | Runs the same TypeScript with path aliases |
| Lint | oxlint | Matches the Turnip UI reference repo |

```
src/domain/         pure, isomorphic: state machine, money, addresses, types, view shapes
src/server/chain/   ChainReader: Arc RPC reader, recorded-fixture reader, transfer extraction
src/server/verification/  TaskVerifier interface + registry, TxFactVerifier
src/server/payments/      PaymentProvider (ledger + caps) over PaymentRail (mock | arc)
src/server/store/   SQLite schema and the Store (single funnel for state transitions)
src/server/services/TaskService (lifecycle), Agent (tick), view builders and receipts
src/server/http.ts  route helpers, agent auth, error mapping
src/app/            pages (/, /task/[id], /receipt/[id], /agent) and /api routes
scripts/            agent:tick, agent:loop, demo:seed
aeon/               the Aeon skill that schedules the agent
```

## What is reused

- **Turnip UI** (github.com/aaronjmars/turnip-ui): tokens, type scale, header/nav/wallet-pill chrome, pill buttons, surface cards, notice strip, stat pair, list rows and the 3D mascot PNGs (downscaled into `public/mascots`). The reference repo ships no LICENSE file; its author also maintains Aeon and distributes the look as a reusable skill, but confirm before shipping the mascots publicly.
- **Aeon conventions**: the skill follows the house shape (`requires:` allowlist, `./secretcurl` placeholders, silent on no signal, `memory/logs` dedup).

## What was added

- Explicit task state machine with an ACCEPTED state between a passing verification and a confirmed payout, so a failed payout never loses the fact that the worker earned it.
- Deterministic verifier that re-reads the transaction from Arc and compares checksummed recipient and integer micro-USDC amount.
- Ledger payment provider with idempotent fund/release/refund keyed by task id, a per-task cap, a 24h payout cap and an outstanding-escrow cap.
- Append-only task events and immutable receipts enforced by SQLite triggers, with a sha256 digest stored at settlement.
- An agent tick that sweeps every task needing attention and keeps the open-task supply topped up, logging each action as an AgentRun.

## What is mocked

- `PAYMENT_PROVIDER=mock`: payouts are recorded in the ledger with a deterministic id (keccak of the idempotency key). The UI labels them Simulated everywhere. No funds move.
- `CHAIN_READER=fixture`: eight real Arc Testnet transfers recorded on 2026-10-02, used by tests and offline demos.

## What is real

- Task sourcing and verification read Arc Testnet RPC by default (`CHAIN_READER=rpc`). Every task points at a real transaction you can open in the explorer.
- `PAYMENT_PROVIDER=arc` sends real USDC ERC-20 transfers on Arc Testnet from a capped hot wallet. Payouts are signed and stored before broadcast, so a retry rebroadcasts the identical transaction (same nonce) rather than paying twice.
- State machine, caps, idempotency, receipts and the agent loop are the same code in both modes.

## Escrow model

Funding reserves the reward against the payer wallet's balance (checked on chain for `arc`) and against the escrow cap. Refunding releases that reservation; because funds never left the payer wallet there is no refund transfer, and the receipt says so. A dedicated escrow contract is the next step if workers need on-chain proof that the reward existed before they started.
