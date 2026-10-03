# Architecture

Next.js App Router on Node. Server components read through `src/server/queries.ts`; writes go through route handlers in `src/app/api`. All domain logic is in plain TypeScript under `src/domain` and `src/server`, tested without a browser or network.

## Modules

| Path | Responsibility |
|---|---|
| `src/domain/` | Pure types and rules: task states (`task-state.ts`), finding statuses (`findings.ts`), money, addresses, view shapes |
| `src/server/store/` | Postgres access. `Store` owns tasks, attempts, events, payments, receipts, agent runs, leases. `WatchStore` owns repos, observed runs, findings. `db.ts` is the PGlite/Neon seam and the AsyncLocalStorage transaction scope |
| `src/server/github/client.ts` | The read-only slice of the GitHub REST API Proofwork uses |
| `src/server/services/observer.ts` | Deterministic CI watching: runs, failure signatures, evidence, resolution, recurrence |
| `src/server/services/work-service.ts` | Engineer decisions (externalize, keep internal, dismiss), Aeon investigations, contributor claim and submission |
| `src/server/services/task-service.ts` | The task lifecycle shared by every task kind: fund, publish, claim, submit, verify, pay, refund, receipts |
| `src/server/services/agent.ts` | One tick: observe repos, then sweep every task that needs attention |
| `src/server/verification/` | `CiFixVerifier` (GitHub Actions) and `TxFactVerifier` (Arc rail test) |
| `src/server/payments/` | `LedgerPaymentProvider` (caps, idempotency, sign-store-broadcast) over a rail: mock, direct Arc transfer, or `ArcEscrowRail` |
| `src/server/owner.ts` | Owner sessions and the owner request check |
| `aeon/` | Aeon skills and scripts (scheduler and investigator) |
| `contracts/` | `ProofworkEscrow.sol` and its Foundry tests |

## Data model

- **repos**: one watched workflow per connected repository (`owner/name`, default branch, workflow id and path).
- **workflow_runs**: every completed default-branch run the observer has seen, with the failing job, step and signature. A run is recorded once (primary key), so polls never double count.
- **findings**: one per (repo, failure signature). The signature is `sha256(workflow path, job, step)`. Holds the evidence (log excerpt, step command, regression window) and Aeon's investigation. `finding_events` is its append-only history.
- **tasks**: one row per unit of paid work. `kind` is `ci-fix` (a work package) or `tx-fact-check` (the Arc rail test). `spec_json` holds what the engineer froze at approval: repo, workflow, job, acceptance, scope, protected paths, merge requirement and the allowlist of `{login, wallet}`.
- **attempts**: claims and submissions. For work packages the claim records the GitHub login and the allowlisted wallet.
- **payments**: at most one `fund`, `release` and `refund` per task (unique constraint). Signed transactions are stored before broadcast.
- **receipts**: written once when a task settles, with a sha256 digest of the body. Updates and deletes are rejected by a trigger.

## Finding lifecycle

```
watching --(same job+step fails again)--> candidate --(Aeon)--> investigated
candidate | investigated | recurred --(engineer)--> internal | externalized | dismissed
any open status --(green run on default branch)--> resolved --(same failure again)--> recurred
externalized --(work package refunded)--> candidate
```

Transitions are listed in `src/domain/findings.ts` and enforced in `WatchStore.updateFinding`, which locks the row, checks the table and appends the event in one transaction.

A recurrence starts a new failure episode: the finding's first red commit and failure count reset to the new failure, the evidence window runs from the fix's green commit to it, and an investigation older than the latest recurrence no longer counts, so Aeon investigates the new episode. Earlier episodes stay in `finding_events`.

## Task lifecycle

```
DRAFT -> FUNDED -> OPEN -> CLAIMED -> SUBMITTED -> VERIFYING -> ACCEPTED -> PAID
                     |        |                       |-> REJECTED -> OPEN | EXPIRED
                     |        '-> OPEN (released) | EXPIRED (deadline)
                     '-> EXPIRED -> REFUNDED
```

`Store.transition` is the only way a task changes state: it locks the row (`SELECT ... FOR UPDATE`), checks the expected state and the legal-transition table, bumps the version and appends the event in one transaction.

For work packages: the claim lasts until the deadline; a rejected submission reopens the package for the allowlist; a submission still waiting on CI is judged until the deadline plus `CI_VERIFY_GRACE_SECONDS`, then fails; a missed deadline refunds and hands the finding back to the engineer.

## Verification

`CiFixVerifier` decides only from GitHub's records:

1. The PR targets the task's repository and base branch.
2. It was opened by the GitHub login holding the claim.
3. None of its files (including renames' old paths) is under a protected path. `.github/` and the workflow file are always protected; the engineer can add more, such as the test directory. More than 3000 files cannot be checked and fails.
4. The acceptance job of the watched workflow concluded `success` on the exact commit: the merge commit's `push` run on the base branch when a merge is required (the default), otherwise the PR head's `pull_request` run. Every matrix leg must pass.

Anything not decided yet (no merge, CI still running, GitHub unreachable) leaves the task `SUBMITTED` with a `verification_pending` or `verification_error` event; it is never a failure for the contributor until the grace period ends.

## Scheduling

`POST /api/agent/tick` runs one sweep under a lease: observe each active repo (at most every `OBSERVE_INTERVAL_SECONDS`), then publish, release lapsed claims, expire, refund, verify and pay. Aeon's `proofwork-loop` calls it every 10 minutes; Vercel Cron calls `/api/cron/tick` daily as a fallback. Submissions and "Check again" verify inline so a contributor sees the verdict immediately.

## Storage

Production uses Neon Postgres through `@neondatabase/serverless`. Local development and tests use PGlite, the same Postgres in WASM, so there is one SQL dialect. Tests share one in-memory database per file and truncate between cases. The schema is applied idempotently on first use, under an advisory lock on Neon.
