# Driving Proofwork with Aeon

Aeon is the part of the system that watches and prepares. Five skills:

| Skill | Mode | What it does | What it can never do |
|---|---|---|---|
| `proofwork-loop` | read-only | Calls `POST /api/agent/tick` once per run: the server observes connected repos, verifies submitted fixes, pays, reopens and refunds. Notifies on new findings, payouts, refunds and recurrences | Choose work, people or amounts; call any other endpoint |
| `proofwork-investigate` | write | Picks one finding that needs an investigation (a new candidate, or a recurrence whose episode is newer than its last investigation), reproduces the failing step at the first red and last green commit in its runner, bisects, and posts an investigation with a proposed acceptance condition | Approve, price, assign or open PRs. Its only write is the investigation endpoint |
| `proofwork-reproduce` | write | Picks one open issue labeled as a bug, writes one test that fails because of it, runs the repository's test command with and without that test, and posts the result. A reproduced bug becomes a finding the engineer decides on, and a fix is paid only if it adds that test unchanged and CI passes | Change any file but the new test, approve, price, assign or open PRs. Its only write is the reproduction endpoint |
| `arc-studio` | write | Drives Circle Arc Studio (it wrote, tested and deployed `ProofworkEscrow`) | Touch Proofwork data |
| `messaging-review` | read-only | Weekly: reviews the site's copy against the messaging playbook, suggests rewrites, tracks which were adopted, and learns one pattern from a reference site | Edit the site or open PRs; it recommends and notifies |

The deterministic work (detecting repeats, verifying with GitHub Actions, moving funds under caps) happens on the Proofwork server. The model decides when to run, explains failures, and tells you what happened.

## Install into an Aeon instance

The `aeon/` folder is an Aeon skill pack (`skills-pack.json`) with three skills: `proofwork-loop`, `proofwork-investigate` and `proofwork-reproduce`. Running Aeon yourself is optional: bontravail.xyz already runs it for every connected repository.

1. **Get an Aeon instance.** Fork [Aeon](https://github.com/aeonfun/aeon) into your account and add your model key as a repo secret.
2. **Install the pack** from a checkout of your instance:

   ```bash
   bin/install-skill-pack Svector-anu/bon-travail --path aeon
   ```

3. **Add the agent token** the skills use to talk to bon travail. For bontravail.xyz, ask at hello@bontravail.xyz; for your own deployment it is the server's `AGENT_API_TOKEN`:

   ```bash
   gh secret set PROOFWORK_AGENT_TOKEN -R <your-aeon-repo>   # paste on stdin
   ```

4. **Enable the skills** in `aeon.yml` (quoted schedules):

   ```yaml
     proofwork-loop: { enabled: true, schedule: "*/10 * * * *", var: "https://bontravail.xyz" }
     proofwork-investigate: { enabled: true, schedule: "17 * * * *", var: "https://bontravail.xyz" }
     proofwork-reproduce: { enabled: true, schedule: "47 * * * *", var: "https://bontravail.xyz" }
   ```

Run each once by hand before relying on the schedule:

```bash
gh workflow run aeon.yml -R <your-aeon-repo> -f skill=proofwork-loop -f var=https://bontravail.xyz
gh workflow run aeon.yml -R <your-aeon-repo> -f skill=proofwork-investigate -f var=https://bontravail.xyz
gh workflow run aeon.yml -R <your-aeon-repo> -f skill=proofwork-reproduce -f var=https://bontravail.xyz
```

GitHub delivers cron ticks late and sometimes skips them; that is fine. Submissions are verified the moment a contributor asks, and the tick is the safety net. Set `AGENT_EXPECTED_INTERVAL_SECONDS` to match the schedule (600 for `*/10`) so the agent page reports "Offline" only when Aeon really stopped.

Notes from running them:

- `arc-studio` reports Arc Studio's own answer for a settled turn, scrubbed and capped, labeled as unverified. Keep its `var` prompt under about 250 characters: Aeon's workflow puts it in the run title, and a longer dispatch fails before any job starts.
- After a recurrence, `proofwork-investigate` re-investigates: the observer starts a new episode and the previous investigation no longer counts.

## Requirements on the Proofwork side

- A public URL reachable from GitHub Actions.
- `AGENT_API_TOKEN` set; without it every agent endpoint refuses.
- `GITHUB_TOKEN` set, so the server can observe repos and verify PRs.

## Without Aeon

`npm run agent:loop` runs the same sweep every `AGENT_LOOP_SECONDS`; `npm run agent:tick` runs one. The investigation script runs anywhere with Node and git: `SKILL_VAR=<base> PROOFWORK_AGENT_TOKEN=... node aeon/scripts/proofwork-investigate.mjs prepare`, write `report.json`, then `submit`.
