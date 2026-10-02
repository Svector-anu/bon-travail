# Proofwork

An autonomous agent posts small, machine-checkable tasks on Arc Testnet, a human answers one, the server verifies the answer exactly against the chain, and the agent pays USDC or refunds the reward. Every outcome gets a public receipt.

The one task type is an onchain fact check: *read this Arc transaction and reply with the recipient address and the exact USDC amount.*

```
agent tick -> create -> fund -> publish -> OPEN
worker     -> claim (10 min lock) -> submit
server     -> verify against Arc RPC -> ACCEPTED -> pay -> PAID -> frozen receipt
                                     -> REJECTED -> reopen (or expire) -> refund -> REFUNDED
agent tick -> expire overdue, refund, retry stuck work, post the next task
```

See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for architecture and what is mocked versus real, and [aeon/README.md](aeon/README.md) for the Aeon schedule.

## Run locally

Requires Node 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env.local
# set AGENT_API_TOKEN, e.g. openssl rand -hex 32
npm run dev                # http://localhost:3000
npm run agent:loop         # in a second terminal: the agent, ticking every 30s
```

With an empty database, the first tick scans recent Arc blocks for a single-transfer USDC transaction and publishes it as TASK-001.

## Demo mode

```bash
npm run demo:seed -- --reset           # stop `npm run dev` first if it holds the database
npm run dev
AGENT_LOOP_SECONDS=15 npm run agent:loop
```

The seed drives the real engine with deterministic demo wallets:

| Task | What happens | End state |
|---|---|---|
| TASK-001 | correct answer | PAID |
| TASK-002 | wrong amount, then its deadline passes | REJECTED, then REFUNDED |
| TASK-003 | no submission, expires `DEMO_EXPIRY_SECONDS` (120) after seeding | OPEN until the agent loop refunds it |
| TASK-004 | correct answer | PAID |
| TASK-005 | posted by a seed-time agent tick | OPEN, the live task for the demo |

Demo recording, about 45 seconds: open `/`, point at the agent strip, open TASK-005, paste a payout address and claim, open the transaction in the explorer, submit recipient and amount, watch it verify and pay, open the receipt and its explorer link, return to `/agent` to see TASK-003 expire and refund and the next task appear, all from the loop.

Add `CHAIN_READER=fixture` to run offline against recorded Arc transactions.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PAYMENT_PROVIDER` | none, required | `mock` or `arc`. Missing or unknown values stop the app (fail closed) |
| `ARC_PAYER_PRIVATE_KEY` | | Required for `arc`. Testnet hot wallet holding only the reward float |
| `AGENT_API_TOKEN` | | Bearer token for agent-only endpoints. Unset disables them |
| `MAX_REWARD_USDC` | 1 | Per-task cap |
| `DAILY_PAYOUT_CAP_USDC` | 10 | Rolling 24h payout cap |
| `MAX_OUTSTANDING_ESCROW_USDC` | 5 | Total reserved for funded, unsettled tasks |
| `TASK_REWARD_USDC` | 1 | Reward per task, must not exceed the per-task cap |
| `TASK_DEADLINE_SECONDS` | 21600 | 6 hours |
| `CLAIM_TTL_SECONDS` | 600 | Claim lock |
| `TARGET_OPEN_TASKS` | 1 | The agent posts until this many tasks are live |
| `AGENT_EXPECTED_INTERVAL_SECONDS` | 300 | Health turns Stale after twice this with no sweep |
| `CHAIN_READER` | rpc | `rpc` or `fixture` |
| `ARC_RPC_URL` / `ARC_EXPLORER_URL` | Arc Testnet | |
| `DATABASE_PATH` | ./data/proofwork.db | |
| `PUBLIC_BASE_URL` | http://localhost:3000 | Used in links sent to Aeon |
| `AGENT_LOOP_SECONDS` | 30 | `agent:loop` only |

## Switch from mock to real Arc payouts

1. Create a fresh testnet wallet. Fund it from the Circle faucet with a few USDC (gas on Arc is paid in USDC).
2. Put the key in the runtime environment, never in the repo:
   ```bash
   PAYMENT_PROVIDER=arc
   ARC_PAYER_PRIVATE_KEY=0x...
   ```
3. Keep the caps small. Funding fails unless the wallet holds the outstanding escrow plus a 0.05 USDC gas buffer.
4. Payout receipts then link the real transfer on testnet.arcscan.app and drop the Simulated label.

## Security model

- Spending caps are enforced in `LedgerPaymentProvider` in front of any rail: per task, per 24h and total escrow.
- One payment row per (task, kind) via a unique constraint; release and refund are mutually exclusive.
- Payouts are signed, stored, then broadcast. A retry rebroadcasts the same signed transaction.
- Claims are single-winner (state transition with optimistic version check inside `BEGIN IMMEDIATE`) and carry a secret claim token that only the claimer holds.
- One submitted answer per wallet per task (partial unique index), and one submission per claim.
- Task events and receipts are append-only and immutable (SQLite triggers). Receipts carry a sha256 digest.
- Expected answers are withheld from every public response until the task settles.
- No private key in the repo. `.env*` is git-ignored except `.env.example`.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/api/tasks` | public |
| POST | `/api/tasks` `{txHash}` | agent: create, fund, publish |
| GET | `/api/tasks/:id` | public |
| POST | `/api/tasks/:id/claim` `{wallet}` | worker |
| POST | `/api/tasks/:id/submit` `{claimId, claimToken, recipient, amount}` | worker, verifies and pays inline |
| POST | `/api/tasks/:id/verify` | agent |
| POST | `/api/tasks/:id/release` | agent |
| POST | `/api/tasks/:id/refund` | agent, expires an overdue OPEN task first |
| GET | `/api/receipts/:id` | public |
| GET | `/api/agent/activity?limit=&task=` | public |
| POST | `/api/agent/tick` `{source}` | agent, one sweep |

Agent routes need `Authorization: Bearer $AGENT_API_TOKEN`.

## Checks

```bash
npm run check    # typecheck, lint, tests, build
```

## Known limitations

- SQLite on local disk: deploy to a host with a persistent volume (Fly, Railway, a VM). Serverless platforms with ephemeral disks will lose state.
- Aeon runs on GitHub Actions, so the server needs a public URL.
- Sybil griefing: a stream of fresh addresses can each hold the claim lock for 10 minutes. There is no rate limiting yet.
- Refunds are ledger releases, not on-chain transfers, because rewards stay in the payer wallet until paid. An escrow contract would make funding verifiable on chain.
- A signed payout whose nonce gets consumed by another transaction stays `submitted` and needs operator review; the agent reports it as an error each sweep.
- The worker answer is public on chain by design; the task proves the loop, not hard work.
