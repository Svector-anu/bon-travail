#!/usr/bin/env node
/**
 * Bug reproduction, driven by the Aeon `proofwork-reproduce` skill.
 *
 *   node skills/proofwork-reproduce/proofwork-reproduce.mjs prepare
 *     Picks one reported bug, clones its repository at the default branch,
 *     installs dependencies the way CI would, and writes what the model needs
 *     to $PW_WORKDIR/facts.json: the issue, the workflow, the test files.
 *
 *   node skills/proofwork-reproduce/proofwork-reproduce.mjs submit
 *     Reads the model's $PW_WORKDIR/repro.json and the one test file it added,
 *     runs the test command with and without that file, and posts the result.
 *     Only the reproduction endpoint is ever called.
 *
 * Environment: SKILL_VAR (bon travail base URL), PROOFWORK_AGENT_TOKEN.
 * The repository's code runs with a scrubbed environment (no tokens) and a
 * timeout per command.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const WORKDIR = process.env.PW_WORKDIR || '/tmp/proofwork-reproduce'
const REPO = join(WORKDIR, 'repo')
const BASE = (process.env.SKILL_VAR || process.env.PROOFWORK_BASE_URL || '').trim().replace(/\/$/, '')
const TOKEN = process.env.PROOFWORK_AGENT_TOKEN || ''
const COMMAND_TIMEOUT_MS = 300_000
const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\/|[._-](test|spec)\.[a-z]+$|_test\.(go|py)$|^test_.*\.py$/

function fail(message) {
  console.error(`proofwork-reproduce: ${message}`)
  process.exit(1)
}

function requireConfig() {
  if (!/^(https:\/\/[\w.-]+|http:\/\/localhost)(:\d+)?$/.test(BASE)) fail('SKILL_VAR must be the bon travail base URL, e.g. https://bontravail.xyz')
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

/** PATH, HOME and CI only: the repository never sees Aeon's tokens. */
function cleanEnv() {
  return { PATH: process.env.PATH, HOME: join(WORKDIR, 'home'), CI: 'true', LANG: 'C.UTF-8' }
}

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', env: cleanEnv(), timeout: COMMAND_TIMEOUT_MS })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).slice(-400)}`)
  return r.stdout.trim()
}

function run(command) {
  const r = spawnSync('bash', ['-c', command], { cwd: REPO, encoding: 'utf8', env: cleanEnv(), timeout: COMMAND_TIMEOUT_MS })
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return { outcome: r.error ? 'error' : r.status === 0 ? 'passed' : 'failed', tail: output.split('\n').slice(-40).join('\n').slice(-4000) }
}

/** Installs dependencies the way CI would, without running install scripts. */
function setup() {
  if (existsSync(join(REPO, 'package-lock.json'))) run('npm ci --ignore-scripts --no-audit --no-fund')
  else if (existsSync(join(REPO, 'package.json'))) run('npm install --ignore-scripts --no-audit --no-fund')
}

/** Every single-line `run:` command in the watched workflow: the commands CI really runs. */
function ciCommands(workflowYaml) {
  return [...workflowYaml.matchAll(/^\s*(?:-\s*)?run:\s*(.+)$/gm)]
    .map((m) => m[1].trim().replace(/^["']|["']$/g, ''))
    .filter((r) => r && !r.startsWith('|') && !r.startsWith('>'))
}

/** The CI command that runs the tests, as a starting point for the model. */
function testCommandHint(commands) {
  return commands.find((r) => /\btest\b|pytest|vitest|jest|mocha|cargo test|go test/.test(r)) ?? null
}

async function prepare() {
  requireConfig()
  const { bugs } = await api('/api/agent/bugs')
  const bug = bugs[0] ?? null
  rmSync(WORKDIR, { recursive: true, force: true })
  mkdirSync(join(WORKDIR, 'home'), { recursive: true })
  if (!bug) {
    writeFileSync(join(WORKDIR, 'facts.json'), JSON.stringify({ bug: null }))
    console.log('PROOFWORK_REPRODUCE_IDLE: no bug is waiting to be reproduced')
    return
  }
  const clone = spawnSync('git', ['clone', '--quiet', '--no-tags', '--branch', bug.defaultBranch, bug.cloneUrl, REPO], {
    encoding: 'utf8',
    env: cleanEnv(),
    timeout: COMMAND_TIMEOUT_MS,
  })
  if (clone.status !== 0) fail(`could not clone ${bug.repo}: ${(clone.stderr || '').slice(-300)}`)
  const baseSha = git(['rev-parse', 'HEAD'])
  setup()

  const workflowFile = join(REPO, bug.workflowPath)
  const workflowYaml = existsSync(workflowFile) ? readFileSync(workflowFile, 'utf8').slice(0, 8000) : ''
  let scripts = null
  try {
    scripts = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts ?? null
  } catch {
    scripts = null
  }
  const files = git(['ls-files']).split('\n')
  const facts = {
    bug,
    baseSha,
    // What installing dependencies already changed, so it is not mistaken for the model's edits.
    setupChanges: changedPaths(),
    repoDir: REPO,
    workflowYaml,
    packageScripts: scripts,
    ciCommands: ciCommands(workflowYaml),
    testCommandHint: testCommandHint(ciCommands(workflowYaml)),
    testFiles: files.filter((f) => TEST_FILE.test(f)).slice(0, 60),
    runUrl:
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
  }
  writeFileSync(join(WORKDIR, 'facts.json'), JSON.stringify(facts, null, 2))
  console.log(
    `PROOFWORK_REPRODUCE_READY ${bug.repo}#${bug.issueNumber} "${bug.issueTitle}" at ${baseSha.slice(0, 7)}. Facts in ${join(WORKDIR, 'facts.json')}; add one test file under ${REPO}, then write ${join(WORKDIR, 'repro.json')}.`,
  )
}

/** Paths that differ from the commit, read NUL-separated so leading status spaces and odd names survive. */
function changedPaths() {
  const r = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: REPO, encoding: 'utf8', env: cleanEnv() })
  if (r.status !== 0) throw new Error(`git status failed: ${(r.stderr || '').slice(-300)}`)
  return r.stdout
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.slice(3))
}

/** The test file the model added: exactly one new file, nothing else changed since setup. */
function addedTestFile(testPath, setupChanges) {
  const path = normalize(testPath).replace(/^\.\//, '')
  if (path.startsWith('..') || path.startsWith('/') || path.startsWith('.github/')) fail(`testPath ${testPath} must be inside the repository, outside .github/`)
  const others = changedPaths().filter((changed) => changed !== path && !setupChanges.includes(changed))
  if (others.length > 0) fail(`only add the test file; these also changed: ${others.join(', ')}`)
  if (!existsSync(join(REPO, path))) fail(`${path} does not exist in the repository`)
  return path
}

async function submit() {
  requireConfig()
  const facts = JSON.parse(readFileSync(join(WORKDIR, 'facts.json'), 'utf8'))
  if (!facts.bug) {
    console.log('PROOFWORK_REPRODUCE_IDLE: nothing to submit')
    return
  }
  const report = JSON.parse(readFileSync(join(WORKDIR, 'repro.json'), 'utf8'))
  const testPath = addedTestFile(report.testPath, facts.setupChanges ?? [])
  const testContent = readFileSync(join(REPO, testPath), 'utf8')

  // Only a command the watched workflow already runs is ever executed here: the model's choice is
  // checked first, because the issue it read is untrusted and could have talked it into anything.
  const ciCommands = facts.ciCommands ?? []
  const command = ciCommands.find((c) => c === String(report.testCommand ?? '').trim()) ?? null
  const runByCi = command !== null
  const skipped = { outcome: 'error', tail: '' }
  let withTest = skipped
  let withoutTest = skipped
  if (runByCi) {
    withTest = run(command)
    const aside = join(WORKDIR, 'aside')
    mkdirSync(dirname(join(aside, testPath)), { recursive: true })
    renameSync(join(REPO, testPath), join(aside, testPath))
    withoutTest = run(command)
    renameSync(join(aside, testPath), join(REPO, testPath))
  }

  // A test CI never runs cannot judge a fix, and a suite that was already red only counts if it names the test.
  const namesTest = withoutTest.outcome === 'passed' || withTest.tail.includes(testPath.split('/').pop())
  const reproduced = runByCi && withTest.outcome === 'failed' && namesTest
  const why = !runByCi
    ? `${report.testCommand} is not a command ${facts.bug.workflowPath} runs, so CI would never run ${testPath}. The test has to run under the workflow's own test command (${(facts.ciCommands ?? []).join(', ') || 'none found'}).`
    : withTest.outcome !== 'failed'
      ? `The test command ${withTest.outcome} with ${testPath} added, so it does not show the bug.`
      : `The suite already failed without ${testPath}, and the failure does not name it.`
  const body = {
    reproduced,
    note: reproduced ? null : [report.note, why].filter(Boolean).join(' '),
    testPath,
    testContent,
    testCommand: command ?? String(report.testCommand ?? '').slice(0, 500),
    baseSha: facts.baseSha,
    withTest: withTest.outcome,
    withoutTest: withoutTest.outcome,
    failingOutput: withTest.tail,
    summary: report.summary,
    rootCause: report.rootCause,
    proposedScope: report.proposedScope,
    confidence: reproduced && withoutTest.outcome === 'passed' ? report.confidence : 'low',
    runUrl: facts.runUrl,
  }
  const result = await api(`/api/agent/bugs/${facts.bug.id}/reproduction`, { method: 'POST', body: JSON.stringify(body) })
  const where = result.findingId ? `${BASE}/console/findings/${result.findingId}` : facts.bug.issueUrl
  console.log(
    `PROOFWORK_REPRODUCE_SUBMITTED ${facts.bug.repo}#${facts.bug.issueNumber} -> ${result.status} (with test: ${withTest.outcome}, without: ${withoutTest.outcome}). ${where}`,
  )
}

const mode = process.argv[2]
if (mode === 'prepare') await prepare()
else if (mode === 'submit') await submit()
else fail('usage: proofwork-reproduce.mjs prepare|submit')
