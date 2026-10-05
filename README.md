# bon travail

agents find the work. people fix it. proof pays.

live: https://bon-travail.vercel.app (arc testnet). the first real loop is [work-001's receipt](https://bon-travail.vercel.app/receipt/task_001).

bon travail (the codebase is `proofwork`) watches the github actions workflow of a repository your team connects. when the same job and step fail twice in a row, it records a finding with github's evidence, and aeon reproduces and bisects it. an engineer then decides: keep the fix in the team, or externalize it to named people with a reward and a deadline. an approved contributor opens a pull request; github actions decides whether it passes; the reward is paid from an escrow contract on arc, or refunded at the deadline. every outcome is sealed in a public receipt, and the observer keeps watching for the failure to come back.

```text
observer   github runs on the default branch -> repeated failure -> finding + evidence
aeon       clone, reproduce red and green, git bisect -> investigation (recommendation only)
engineer   keep internal | dismiss | externalize: reward, deadline, allowlist, acceptance, scope
escrow     usdc moves into proofworkescrow on arc
contributor link a pr that mentions work-00n -> claim -> request verification
github     acceptance job passes on the merge commit (or pr head), protected paths untouched
settle     paid to the allowlisted wallet | refunded at the deadline -> sealed receipt
observer   green resolves the finding; the same failure later is a recurrence
```

machines discover, prepare and verify. people do the work. engineers own every decision: architecture, secrets, scope, who may claim, the reward and the release. no agent can approve work, choose who is paid, set an amount, or release funds; see [docs/security.md](docs/security.md).

- [docs/architecture.md](docs/architecture.md): modules, data model, state machines, verification
- [docs/security.md](docs/security.md): authority boundaries and why they exist
- [docs/escrow.md](docs/escrow.md): the arc escrow contract and payment lifecycle
- [aeon/readme.md](aeon/readme.md): the aeon skills and how to schedule them
- [docs/visuals.md](docs/visuals.md): the image set, type and motion system

the site itself has a short guide at `/docs`.

## run locally

requires node 22.

```bash
npm install
cp .env.example .env.local
# set agent_api_token and session_secret (openssl rand -hex 32 each), owner_github_logins=<your login>
npm run github:app -- --base http://localhost:3000   # once: creates your github app, writes its keys
npm run dev                                         # http://localhost:3000, embedded postgres in ./data/pglite
npm run agent:loop                                  # second terminal: the agent tick every 30s
```

open `/console`, **sign in with github**, then **connect github**: install the app on the repositories to watch and press **watch**. the first poll reads the last 30 completed runs of the workflow on the default branch. without an app, `github_token=$(gh auth token)` and a typed `owner/name` still work for local development.

`npm run demo:seed -- --reset` still seeds scripted rail-test history (arc transaction fact-checks) for ui work; it refuses to run against a hosted database.

## dogfood the whole loop

the public sandbox [svector-anu/usdc-sdk-examples](https://github.com/svector-anu/usdc-sdk-examples) has one workflow, `examples`, with an `examples` job.

1. **break it.** push a regression to `main` twice (two red runs of the same step).
2. **observe.** the agent tick (or "check now" in the console) turns the repeat into a candidate finding with the log excerpt, the failing command and the commit window.
3. **investigate.** dispatch the aeon skill: `gh workflow run aeon.yml -r <aeon-fork> -f skill=proofwork-investigate -f harness=claude -f var=<base url>`. the finding gains aeon's reproduction, first bad commit and proposed acceptance.
4. **decide.** in the console, open the finding, edit acceptance and scope, set the reward, deadline and allowlist (github login + payout wallet), and approve. the reward is escrowed.
5. **fix.** as the contributor, open a pr that mentions the `work-00n` id, paste it on the work page to claim, then "request verification".
6. **verify.** merge the pr. when the `examples` job passes on the merge commit, the next tick (or "check again") pays the allowlisted wallet and seals the receipt.
7. **watch.** the green run resolves the finding. reintroduce the bug and the observer reports a recurrence on the same finding, visible on the receipt's live recurrence panel.

## environment

all variables are documented in [.env.example](.env.example). the ones that matter:

| variable | purpose |
|---|---|
| `database_url` | postgres (neon). unset: embedded pglite at `database_path` |
| `github_app_*` | the github app: sign-in and repository access (`npm run github:app` creates it) |
| `owner_github_logins` | github logins allowed into the engineer console |
| `session_secret` | signs console sessions |
| `github_token` | local fallback when no app is configured |
| `owner_access_token` | optional bearer for scripts; the ui never asks for it |
| `agent_api_token` | aeon's bearer token for tick, findings and investigations. unset: agent endpoints off |
| `payment_provider` | `mock`, `arc` or `arc-escrow`. required; there is no default |
| `arc_payer_private_key`, `arc_escrow_address` | operator wallet and escrow contract for `arc-escrow` |
| `escrow_namespace` | prefix of escrow task keys; unique per deployment sharing a contract |
| `max_reward_usdc`, `daily_payout_cap_usdc`, `max_outstanding_escrow_usdc` | spending caps enforced before every payment |
| `cron_secret` | lets vercel cron call `/api/cron/tick` as a fallback schedule |
| `public_base_url` | used in receipt links sent to aeon notifications |

## deploy on vercel

1. `vercel link`, then add neon from the vercel marketplace (it sets `database_url`). the schema is created on first request.  
   create the github app with `npm run github:app -- --base https://<your deployment>` and copy its five `github_app_*` values.
2. add the variables above as encrypted environment variables (`vercel env add name production`). never commit them.
3. `vercel deploy --prod`. `vercel.json` registers a daily cron for `/api/cron/tick`; aeon's `proofwork-loop` is the real schedule (every 10 minutes).
4. point aeon's `proofwork-loop` and `proofwork-investigate` `var` at the deployment url and set `proofwork_agent_token` to the deployment's `agent_api_token`.

## checks

```bash
npm run check    # typecheck, lint, tests (pglite, no network), build
```

contract tests for `contracts/proofworkescrow.sol` run with foundry: `forge test`.
