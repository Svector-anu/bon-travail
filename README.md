# Bon Travail

Agents find the work. People fix it. Proof pays.

Live: https://bon-travail.vercel.app (Arc testnet). The first real loop is [WORK-001's receipt](https://bon-travail.vercel.app/receipt/task_001).

Bon Travail (the codebase is `proofwork`) watches the GitHub Actions workflow of a repository your team connects. When the same job and step fail twice in a row, it records a finding with GitHub's evidence, and Aeon reproduces and bisects it. An engineer then decides: keep the fix in the team, or externalize it to named people with a reward and a deadline. An approved contributor opens a pull request; GitHub Actions decides whether it passes; the reward is paid from an escrow contract on Arc, or refunded at the deadline. Every outcome is sealed in a public receipt, and the observer keeps watching for the failure to come back.

```
observer   GitHub runs on the default branch -> repeated failure -> finding + evidence
Aeon       clone, reproduce red and green, git bisect -> investigation (recommendation only)
engineer   keep internal | dismiss | externalize: reward, deadline, allowlist, acceptance, scope
escrow     USDC moves into ProofworkEscrow on Arc
contributor link a PR that mentions WORK-00n -> claim -> request verification
GitHub     acceptance job passes on the merge commit (or PR head), protected paths untouched
settle     PAID to the allowlisted wallet | REFUNDED at the deadline -> sealed receipt
observer   green resolves the finding; the same failure later is a recurrence
```

Machines discover, prepare and verify. People do the work. Engineers own every decision: architecture, secrets, scope, who may claim, the reward and the release. No agent can approve work, choose who is paid, set an amount, or release funds; see [docs/SECURITY.md](docs/SECURITY.md).

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, data model, state machines, verification
- [docs/SECURITY.md](docs/SECURITY.md): authority boundaries and why they exist
- [docs/ESCROW.md](docs/ESCROW.md): the Arc escrow contract and payment lifecycle
- [aeon/README.md](aeon/README.md): the Aeon skills and how to schedule them

## Run locally

Requires Node 22.

```bash
npm install
cp .env.example .env.local
# set AGENT_API_TOKEN and SESSION_SECRET (openssl rand -hex 32 each), OWNER_GITHUB_LOGINS=<your login>
npm run github:app -- --base http://localhost:3000   # once: creates your GitHub App, writes its keys
npm run dev                                         # http://localhost:3000, embedded Postgres in ./data/pglite
npm run agent:loop                                  # second terminal: the agent tick every 30s
```

Open `/console`, **Sign in with GitHub**, then **Connect GitHub**: install the app on the repositories to watch and press **Watch**. The first poll reads the last 30 completed runs of the workflow on the default branch. Without an app, `GITHUB_TOKEN=$(gh auth token)` and a typed `owner/name` still work for local development.

`npm run demo:seed -- --reset` still seeds scripted rail-test history (Arc transaction fact-checks) for UI work; it refuses to run against a hosted database.

## Dogfood the whole loop

The public sandbox [Svector-anu/usdc-sdk-examples](https://github.com/Svector-anu/usdc-sdk-examples) has one workflow, `Examples`, with an `examples` job.

1. **Break it.** Push a regression to `main` twice (two red runs of the same step).
2. **Observe.** The agent tick (or "Check now" in the console) turns the repeat into a candidate finding with the log excerpt, the failing command and the commit window.
3. **Investigate.** Dispatch the Aeon skill: `gh workflow run aeon.yml -R <aeon-fork> -f skill=proofwork-investigate -f harness=claude -f var=<base URL>`. The finding gains Aeon's reproduction, first bad commit and proposed acceptance.
4. **Decide.** In the console, open the finding, edit acceptance and scope, set the reward, deadline and allowlist (GitHub login + payout wallet), and approve. The reward is escrowed.
5. **Fix.** As the contributor, open a PR that mentions the `WORK-00n` id, paste it on the work page to claim, then "Request verification".
6. **Verify.** Merge the PR. When the `examples` job passes on the merge commit, the next tick (or "Check again") pays the allowlisted wallet and seals the receipt.
7. **Watch.** The green run resolves the finding. Reintroduce the bug and the observer reports a recurrence on the same finding, visible on the receipt's live recurrence panel.

## Environment

All variables are documented in [.env.example](.env.example). The ones that matter:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (Neon). Unset: embedded PGlite at `DATABASE_PATH` |
| `GITHUB_APP_*` | The GitHub App: sign-in and repository access (`npm run github:app` creates it) |
| `OWNER_GITHUB_LOGINS` | GitHub logins allowed into the engineer console |
| `SESSION_SECRET` | Signs console sessions |
| `GITHUB_TOKEN` | Local fallback when no app is configured |
| `OWNER_ACCESS_TOKEN` | Optional bearer for scripts; the UI never asks for it |
| `AGENT_API_TOKEN` | Aeon's bearer token for tick, findings and investigations. Unset: agent endpoints off |
| `PAYMENT_PROVIDER` | `mock`, `arc` or `arc-escrow`. Required; there is no default |
| `ARC_PAYER_PRIVATE_KEY`, `ARC_ESCROW_ADDRESS` | Operator wallet and escrow contract for `arc-escrow` |
| `ESCROW_NAMESPACE` | Prefix of escrow task keys; unique per deployment sharing a contract |
| `MAX_REWARD_USDC`, `DAILY_PAYOUT_CAP_USDC`, `MAX_OUTSTANDING_ESCROW_USDC` | Spending caps enforced before every payment |
| `CRON_SECRET` | Lets Vercel Cron call `/api/cron/tick` as a fallback schedule |
| `PUBLIC_BASE_URL` | Used in receipt links sent to Aeon notifications |

## Deploy on Vercel

1. `vercel link`, then add Neon from the Vercel marketplace (it sets `DATABASE_URL`). The schema is created on first request.
   Create the GitHub App with `npm run github:app -- --base https://<your deployment>` and copy its five `GITHUB_APP_*` values.
2. Add the variables above as encrypted environment variables (`vercel env add NAME production`). Never commit them.
3. `vercel deploy --prod`. `vercel.json` registers a daily cron for `/api/cron/tick`; Aeon's `proofwork-loop` is the real schedule (every 10 minutes).
4. Point Aeon's `proofwork-loop` and `proofwork-investigate` `var` at the deployment URL and set `PROOFWORK_AGENT_TOKEN` to the deployment's `AGENT_API_TOKEN`.

## Checks

```bash
npm run check    # typecheck, lint, tests (PGlite, no network), build
```

Contract tests for `contracts/ProofworkEscrow.sol` run with Foundry: `forge test`.
