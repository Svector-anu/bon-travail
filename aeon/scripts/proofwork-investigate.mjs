#!/usr/bin/env node
/**
 * Proofwork investigation, driven by the Aeon `proofwork-investigate` skill.
 *
 *   node scripts/proofwork-investigate.mjs prepare
 *     Picks one finding that wants an investigation, clones its repository,
 *     reproduces the failing step at the first red commit and the last green
 *     one, bisects the window between them, and writes the facts to
 *     $PW_WORKDIR/facts.json for the model to read.
 *
 *   node scripts/proofwork-investigate.mjs submit
 *     Merges facts.json with the model's $PW_WORKDIR/report.json and posts
 *     it to Proofwork. Only the investigation endpoint is ever called.
 *
 * Environment: SKILL_VAR (Proofwork base URL), PROOFWORK_AGENT_TOKEN.
 * The repository's own code runs with a scrubbed environment (no tokens),
 * a timeout per command, and never with network credentials.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WORKDIR = process.env.PW_WORKDIR || '/tmp/proofwork-investigation'
const BASE = (process.env.SKILL_VAR || process.env.PROOFWORK_BASE_URL || '').trim().replace(/\/$/, '')
const TOKEN = process.env.PROOFWORK_AGENT_TOKEN || ''
const COMMAND_TIMEOUT_MS = 180_000
const MAX_BISECT_COMMITS = 40
const MAX_DIFF_CHARS = 12_000

function fail(message) {
  console.error(`proofwork-investigate: ${message}`)
  process.exit(1)
}

function requireConfig() {
  if (!/^(https:\/\/[\w.-]+|http:\/\/localhost)(:\d+)?$/.test(BASE)) fail('SKILL_VAR must be the Proofwork base URL, e.g. https://bon-travail.vercel.app')
  if (TOKEN.length < 32) fail('PROOFWORK_AGENT_TOKEN is missing')
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(30_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) fail(`${init.method ?? 'GET'} ${path} -> ${res.status} ${body.message ?? ''}`)
  return body
}

/** Runs git with no secrets in its environment. */
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(), timeout: COMMAND_TIMEOUT_MS })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).slice(-400)}`)
  return r.stdout.trim()
}

/** PATH, HOME and CI only: the repository under investigation never sees Aeon's tokens. */
function cleanEnv() {
  return { PATH: process.env.PATH, HOME: join(WORKDIR, 'home'), CI: 'true', LANG: 'C.UTF-8' }
}

function runStep(command, cwd) {
  const r = spawnSync('bash', ['-c', command], { cwd, encoding: 'utf8', env: cleanEnv(), timeout: COMMAND_TIMEOUT_MS })
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return {
    outcome: r.error ? 'error' : r.status === 0 ? 'passed' : 'failed',
    tail: output.split('\n').slice(-25).join('\n').slice(-2500),
  }
}

/** Installs dependencies the way CI would, when the project has a lockfile and nothing is installed. */
function setup(cwd) {
  if (existsSync(join(cwd, 'package-lock.json')) && !existsSync(join(cwd, 'node_modules'))) {
    runStep('npm ci --ignore-scripts --no-audit --no-fund', cwd)
  }
}

function reproduceAt(sha, command, cwd) {
  git(['checkout', '--quiet', '--force', sha], cwd)
  git(['clean', '-fdxq', '-e', 'node_modules'], cwd)
  setup(cwd)
  return { command, sha, ...runStep(command, cwd) }
}

async function prepare() {
  requireConfig()
  const { findings } = await api('/api/agent/findings?status=candidate,recurred')
  const finding = findings.find((f) => !f.alreadyInvestigated && f.stepCommand) ?? null
  rmSync(WORKDIR, { recursive: true, force: true })
  mkdirSync(join(WORKDIR, 'home'), { recursive: true })
  if (!finding) {
    writeFileSync(join(WORKDIR, 'facts.json'), JSON.stringify({ finding: null }))
    console.log('PROOFWORK_INVESTIGATE_IDLE: no finding is waiting for an investigation')
    return
  }

  const repoDir = join(WORKDIR, 'repo')
  git(['clone', '--quiet', '--no-tags', finding.cloneUrl, repoDir], WORKDIR)
  const commands = []
  const red = reproduceAt(finding.firstFailedSha, finding.stepCommand, repoDir)
  commands.push({ ...red, note: 'first failing commit' })
  let green = null
  if (finding.lastGreenSha) {
    green = reproduceAt(finding.lastGreenSha, finding.stepCommand, repoDir)
    commands.push({ ...green, note: 'last green commit' })
  }

  let firstBadSha = null
  let bisectMethod = null
  const reproducible = red.outcome === 'failed' && green?.outcome === 'passed'
  if (reproducible) {
    const window = git(['rev-list', '--count', `${finding.lastGreenSha}..${finding.firstFailedSha}`], repoDir)
    if (Number(window) === 1) {
      firstBadSha = finding.firstFailedSha
      bisectMethod = `Only one commit between the last green (${finding.lastGreenSha.slice(0, 7)}) and first red run; reproduced pass/fail on each side.`
    } else if (Number(window) <= MAX_BISECT_COMMITS) {
      git(['bisect', 'start', finding.firstFailedSha, finding.lastGreenSha], repoDir)
      const script = join(WORKDIR, 'bisect-step.sh')
      writeFileSync(script, `#!/usr/bin/env bash\ngit clean -fdxq -e node_modules\n${finding.stepCommand}\n`, { mode: 0o755 })
      const r = spawnSync('git', ['bisect', 'run', script], { cwd: repoDir, encoding: 'utf8', env: cleanEnv(), timeout: COMMAND_TIMEOUT_MS * 4 })
      const match = /([0-9a-f]{40}) is the first bad commit/.exec(r.stdout ?? '')
      firstBadSha = match ? match[1] : null
      bisectMethod = `git bisect run over ${window} commits between ${finding.lastGreenSha.slice(0, 7)} and ${finding.firstFailedSha.slice(0, 7)}`
      spawnSync('git', ['bisect', 'reset'], { cwd: repoDir, env: cleanEnv() })
    }
  }

  let diff = null
  if (firstBadSha) {
    git(['checkout', '--quiet', '--force', firstBadSha], repoDir)
    diff = git(['show', '--stat', '--patch', '--format=%H%n%an%n%s%n%n%b', firstBadSha], repoDir).slice(0, MAX_DIFF_CHARS)
  }

  const facts = {
    finding,
    reproducible,
    firstBadSha,
    bisectMethod,
    diff,
    commands: commands.map(({ command, sha, outcome, note }) => ({ command, sha, outcome, note })),
    outputs: commands.map(({ sha, tail }) => ({ sha, tail })),
    runUrl:
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
  }
  writeFileSync(join(WORKDIR, 'facts.json'), JSON.stringify(facts, null, 2))
  console.log(
    `PROOFWORK_INVESTIGATE_READY ${finding.displayId} ${finding.repo}: red=${red.outcome} green=${green?.outcome ?? 'n/a'} firstBad=${firstBadSha?.slice(0, 7) ?? 'unknown'}. Facts in ${join(WORKDIR, 'facts.json')}; write ${join(WORKDIR, 'report.json')} next.`,
  )
}

async function submit() {
  requireConfig()
  const facts = JSON.parse(readFileSync(join(WORKDIR, 'facts.json'), 'utf8'))
  if (!facts.finding) {
    console.log('PROOFWORK_INVESTIGATE_IDLE: nothing to submit')
    return
  }
  const report = JSON.parse(readFileSync(join(WORKDIR, 'report.json'), 'utf8'))
  const body = {
    summary: report.summary,
    rootCause: report.rootCause,
    reproduction: report.reproduction ?? [],
    proposedAcceptance: report.proposedAcceptance,
    proposedScope: report.proposedScope,
    suggestedProtectedPaths: report.suggestedProtectedPaths ?? [],
    confidence: facts.reproducible ? report.confidence : 'low',
    firstBadSha: facts.firstBadSha,
    bisectMethod: facts.bisectMethod,
    commands: facts.commands,
    runUrl: facts.runUrl,
  }
  const result = await api(`/api/agent/findings/${facts.finding.id}/investigation`, { method: 'POST', body: JSON.stringify(body) })
  console.log(`PROOFWORK_INVESTIGATE_SUBMITTED ${facts.finding.displayId} -> ${result.status}. ${BASE}/console/findings/${facts.finding.id}`)
}

const mode = process.argv[2]
if (mode === 'prepare') await prepare()
else if (mode === 'submit') await submit()
else fail('usage: proofwork-investigate.mjs prepare|submit')
