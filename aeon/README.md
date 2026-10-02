# Driving Proofwork with Aeon

Aeon is the scheduler. Each run of the `proofwork-loop` skill calls `POST /api/agent/tick` once. The Proofwork server does the deterministic work (expire, refund, verify, pay, reopen, post the next task) and returns a report; the skill turns that report into a notification and a memory log entry.

The model in the loop never moves money. It decides when to tick and what to tell you.

## Install into an Aeon instance

From the root of your Aeon instance repo (see the `aeon` skill, Mode 4):

```bash
mkdir -p skills/proofwork-loop
cp /path/to/proofwork/aeon/skills/proofwork-loop/SKILL.md skills/proofwork-loop/SKILL.md

# Same value as AGENT_API_TOKEN on the Proofwork server
./aeon secrets set PROOFWORK_AGENT_TOKEN --stdin
```

Add the entry to `aeon.yml` by hand, before the `heartbeat:` line, on one line with a quoted schedule (the scheduler skips unquoted values):

```yaml
  proofwork-loop: { enabled: false, schedule: "*/10 * * * *", var: "https://your-proofwork-host" }
```

Then validate, regenerate the catalogs, run once, and enable:

```bash
node scripts/validate-config.js
bash scripts/check-skill-categories.sh
bin/generate-skills-json && bin/generate-packs-json
./aeon skills run proofwork-loop
./aeon skills enable proofwork-loop
grep '^  proofwork-loop:' aeon.yml   # schedule must still be "quoted"
```

GitHub only delivers a fraction of `*/5` cron ticks and Aeon catches up missed slots, so a sweep can land minutes late. That is fine: claim locks are 10 minutes, deadlines are hours, and worker submissions are verified and paid the moment they arrive. The sweep is the safety net and the supply of new tasks.

Set `AGENT_EXPECTED_INTERVAL_SECONDS` on the Proofwork server to match the schedule (600 for `*/10`) so the agent page reports `Stale` only when Aeon really stopped.

## Requirements on the Proofwork side

- The server must be reachable from GitHub Actions (a public URL). A laptop behind NAT needs a tunnel.
- `AGENT_API_TOKEN` must be set; without it the tick endpoint refuses every call.

## Without Aeon

`npm run agent:loop` runs the same sweep every `AGENT_LOOP_SECONDS` against the local database. `npm run agent:tick` runs one sweep and prints the report. Both record `local-loop` or `manual` as the source, so the activity feed always says who triggered what.
