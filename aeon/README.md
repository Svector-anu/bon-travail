# Driving Proofwork with Aeon

Aeon is the part of the system that watches and prepares. Three skills:

| Skill | Mode | What it does | What it can never do |
|---|---|---|---|
| `proofwork-loop` | read-only | Calls `POST /api/agent/tick` once per run: the server observes connected repos, verifies submitted fixes, pays, reopens and refunds. Notifies on new findings, payouts, refunds and recurrences | Choose work, people or amounts; call any other endpoint |
| `proofwork-investigate` | write | Picks one candidate finding, reproduces the failing step at the first red and last green commit in its runner, bisects, and posts an investigation with a proposed acceptance condition | Approve, price, assign or open PRs. Its only write is the investigation endpoint |
| `arc-studio` | write | Drives Circle Arc Studio (it wrote, tested and deployed `ProofworkEscrow`) | Touch Proofwork data |

The deterministic work (detecting repeats, verifying with GitHub Actions, moving funds under caps) happens on the Proofwork server. The model decides when to run, explains failures, and tells you what happened.

## Install into an Aeon instance

From the root of your Aeon instance repo:

```bash
for s in proofwork-loop proofwork-investigate; do
  mkdir -p skills/$s && cp /path/to/proofwork/aeon/skills/$s/SKILL.md skills/$s/SKILL.md
done
cp /path/to/proofwork/aeon/scripts/proofwork-investigate.mjs scripts/

# Same value as AGENT_API_TOKEN on the Proofwork server
gh secret set PROOFWORK_AGENT_TOKEN -R <your-aeon-repo>   # paste on stdin
```

Add `PROOFWORK_AGENT_TOKEN` to the workflow's secret allowlist if your instance keeps one, then add the entries to `aeon.yml` (quoted schedules):

```yaml
  proofwork-loop: { enabled: true, schedule: "*/10 * * * *", var: "https://your-proofwork-host" }
  proofwork-investigate: { enabled: true, schedule: "17 * * * *", var: "https://your-proofwork-host" }
```

Run each once by hand before relying on the schedule:

```bash
gh workflow run aeon.yml -R <your-aeon-repo> -f skill=proofwork-loop -f harness=claude -f var=https://your-proofwork-host
gh workflow run aeon.yml -R <your-aeon-repo> -f skill=proofwork-investigate -f harness=claude -f var=https://your-proofwork-host
```

GitHub delivers cron ticks late and sometimes skips them; that is fine. Submissions are verified the moment a contributor asks, and the tick is the safety net. Set `AGENT_EXPECTED_INTERVAL_SECONDS` to match the schedule (600 for `*/10`) so the agent page reports "Offline" only when Aeon really stopped.

## Requirements on the Proofwork side

- A public URL reachable from GitHub Actions.
- `AGENT_API_TOKEN` set; without it every agent endpoint refuses.
- `GITHUB_TOKEN` set, so the server can observe repos and verify PRs.

## Without Aeon

`npm run agent:loop` runs the same sweep every `AGENT_LOOP_SECONDS`; `npm run agent:tick` runs one. The investigation script runs anywhere with Node and git: `SKILL_VAR=<base> PROOFWORK_AGENT_TOKEN=... node aeon/scripts/proofwork-investigate.mjs prepare`, write `report.json`, then `submit`.
