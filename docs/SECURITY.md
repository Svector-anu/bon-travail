# Security and authority

The product moves money on the strength of other systems' records, so its rules are about who may decide what.

## Who can decide what

| Decision | Who | Enforced in |
|---|---|---|
| Which repositories are watched | Engineer (owner session) | `POST /api/owner/repos` |
| Whether a finding leaves the team | Engineer | `WorkService.externalize`, `keepInternal`, `dismiss` |
| Reward, deadline, scope, acceptance, protected paths | Engineer | frozen in the task's `spec_json` at approval |
| Who may claim, and the wallet they are paid at | Engineer | the allowlist; the claim never accepts a wallet from the request |
| Whether a fix passes | GitHub Actions | `CiFixVerifier` reads the run and job conclusions |
| Merge (the release decision, by default) | Engineer, in GitHub | `requireMerge` verifies the merge commit's run |
| Moving funds | The ledger, only after the verifier accepted | `TaskService.releasePayment` requires `ACCEPTED`; `LedgerPaymentProvider` enforces caps |

## What agents can and cannot do

Aeon holds `AGENT_API_TOKEN`. With it, it can trigger a tick, read findings that want an investigation, and attach an investigation. The investigation parser keeps only descriptive fields; rewards, people and approval sent by an agent are dropped. A tick can verify and settle only what an engineer already approved and GitHub already decided. No agent creates work packages: the tick's automatic task creation is limited to Arc rail tests and is off unless `TARGET_OPEN_TASKS` is set.

The remaining agent endpoints (`/api/tasks/[id]/verify`, `/release`, `/refund`) cannot bypass the state machine: release requires an `ACCEPTED` task, refund requires an expired one.

Why: an agent that could pick recipients or amounts would turn a prompt injection in a log, commit message or PR body into a payment. Keeping agents descriptive means the worst a hostile repository can do is mislead an investigation the engineer then reads.

## Contributors

Contributors have no account. Claiming requires a PR, fetched from GitHub, that is in the right repository and branch, mentions the work package id, and was opened by an allowlisted login. The payout wallet comes from the allowlist entry for that login. Requesting verification or "Check again" can be triggered by anyone; the verdict still pays only the claimant's allowlisted wallet, and "Check again" is rate-limited per task.

Why: GitHub already authenticates the author of a pull request. A separate login would add a second identity to keep in sync with the one that actually did the work.

## The verifier cannot be weakened by the claimant

`.github/` and the watched workflow file are always protected, and the engineer adds the test paths. A PR that touches any of them fails verification. With `requireMerge` (the default) the run that counts is the base branch's own run on the merge commit, which a maintainer chose to merge.

## Owner sessions

Engineers sign in with GitHub through the Bon Travail GitHub App. The OAuth callback checks a per-browser state cookie, exchanges the code once to learn the GitHub login, and discards the user token. Only logins in `OWNER_GITHUB_LOGINS` receive a session: an httpOnly, `SameSite=Strict` cookie holding an HMAC-signed timestamp and `github:<login>`, valid for 7 days. The list is re-checked on every request, so removing a login revokes it immediately, and rotating `SESSION_SECRET` ends every session. Cookie-authenticated writes must carry an `Origin` matching the host. Scripts may send `OWNER_ACCESS_TOKEN` as a bearer instead. With neither configured, every owner endpoint returns 503.

## Repository access

Repositories are read through the GitHub App with read-only permissions (Actions, checks, contents, pull requests, metadata) and no webhooks. Each request uses a short-lived installation token for the installation that covers that repository, so Bon Travail can read exactly the repositories the team installed it on, and nothing it can do writes to them. The installation id GitHub sends back after installing is looked up with the app's own credentials before anything is shown.

## Fail closed

- No `PAYMENT_PROVIDER`: the app refuses to start.
- No `AGENT_API_TOKEN`, `OWNER_ACCESS_TOKEN`, `GITHUB_TOKEN` or `CRON_SECRET`: the corresponding endpoints return 503 instead of running unauthenticated.
- Caps (`MAX_REWARD_USDC`, `DAILY_PAYOUT_CAP_USDC`, `MAX_OUTSTANDING_ESCROW_USDC`) are checked before any payment row is created, and the escrow contract has its own `maxReward`.
- Every payment is keyed by (task, kind) in the database; a retry rebroadcasts the stored signed transaction instead of signing a new one.

## What becomes public

Findings, evidence and the console stay behind the owner session. Externalizing a finding publishes its evidence on the work page and, once settled, in the receipt: job and step names, the failing log excerpt, the commit window and Aeon's summary. That is the point for a public repository; for a private one, read the log excerpt before you externalize. Wallets on the allowlist are not shown, only logins; the paid wallet appears on the receipt, as it does on chain.

## Running untrusted code

`proofwork-investigate` runs the failing step of the watched repository inside Aeon's runner. It does so with `PATH`, `HOME` and `CI` only, so the repository's code cannot read Aeon's tokens, and with a timeout per command. Connect only repositories whose code your own CI already runs.

## Secrets

`.env.local` is git-ignored. Production secrets live in Vercel encrypted environment variables and GitHub Actions secrets. The GitHub token needs read access only. The operator key is a testnet hot wallet funded with the reward float, never a treasury.
