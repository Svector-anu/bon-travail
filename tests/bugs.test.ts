import { describe, expect, it } from 'vitest'
import type { Address } from '@/domain/types'
import { DomainError } from '@/server/errors'
import type { GhIssue } from '@/server/github/client'
import { jobsRunning } from '@/server/services/observer'
import { parseReproduction, type ExternalizeInput } from '@/server/services/work-service'
import { reproTestDigest } from '@/server/verification/repro-test'
import { FakeGitHub, JOB, NAME, OWNER, sha } from './fake-github'
import { OPERATOR, T0, makeApp } from './helpers'

const HOUR = 60 * 60 * 1000
const ADA = 'ada'
const ADA_WALLET: Address = '0x3333333333333333333333333333333333333333'
const REPO = `${OWNER}/${NAME}`
const TEST_PATH = 'test/bug-42.test.js'
const TEST_CONTENT = "import { split } from '../src/split.js'\n\ntest('splits 1 USDC three ways', () => {\n  expect(split('1', 3)).toEqual(['0.333334', '0.333333', '0.333333'])\n})\n"

function issue(overrides: Partial<GhIssue> = {}): GhIssue {
  return {
    number: 42,
    title: 'split() loses a micro-unit on thirds',
    body: 'split("1", 3) returns parts that add up to 0.999999.',
    htmlUrl: `https://github.com/${OWNER}/${NAME}/issues/42`,
    author: 'reporter',
    labels: ['bug'],
    createdAt: T0 - 5 * HOUR,
    ...overrides,
  }
}

function reproduction(overrides: Record<string, unknown> = {}) {
  return {
    reproduced: true,
    testPath: TEST_PATH,
    testContent: TEST_CONTENT,
    testCommand: 'npm test',
    baseSha: sha('a1'),
    withTest: 'failed',
    withoutTest: 'passed',
    failingOutput: 'Expected 0.333334, received 0.333333',
    summary: 'split() drops the remainder when the amount does not divide evenly.',
    rootCause: 'The remainder of the integer division is never handed out in src/split.js.',
    proposedScope: 'Distribute the remainder in src/split.js; leave the tests alone.',
    confidence: 'high',
    runUrl: null,
    ...overrides,
  }
}

function externalizeInput(overrides: Partial<ExternalizeInput> = {}): ExternalizeInput {
  return {
    reward: '0.5',
    deadlineHours: 24,
    contributors: [{ login: ADA, wallet: ADA_WALLET }],
    acceptance: 'The workflow passes with the bug test added unchanged.',
    scope: 'Fix src/split.js.',
    protectedPaths: ['test/'],
    requireMerge: true,
    ...overrides,
  }
}

/** A green repository with one open issue labeled as a bug. */
async function reported(issues: GhIssue[] = [issue()]) {
  const github = new FakeGitHub()
  github.issues = issues
  const app = await makeApp({ github, env: { TARGET_OPEN_TASKS: '0' } })
  github.addRun({ sha: sha('a1'), at: T0 - 4 * HOUR, conclusion: 'success' })
  const { repo, report } = await app.work.connectRepo(REPO, undefined, OPERATOR)
  return { app, github, repo, report }
}

async function reproduced() {
  const ctx = await reported()
  const [bug] = await ctx.app.watch.listBugReports()
  const { finding } = await ctx.app.work.recordReproduction(bug!.id, parseReproduction(reproduction()), 'aeon:reproducer')
  return { ...ctx, bug: bug!, finding: finding! }
}

async function claimedBugWork(files: string[]) {
  const ctx = await reproduced()
  const task = await ctx.app.work.externalize(ctx.finding.id, externalizeInput(), OPERATOR)
  const pr = ctx.github.addPull({ number: 7, author: ADA, title: 'WORK-001: hand out the split remainder' }, files)
  await ctx.app.work.claimWithPullRequest(task.id, pr.htmlUrl)
  await ctx.app.work.submitPullRequest(task.id, pr.htmlUrl)
  ctx.github.merge(7, sha('m1'))
  ctx.github.addRun({ sha: sha('m1'), at: T0 + HOUR, conclusion: 'success' })
  return { ...ctx, task }
}

describe('bug reports from issues', () => {
  it('picks up open issues labeled as bugs and ignores the rest', async () => {
    // #given one bug issue and one feature request
    // #when the repository is connected
    const { app, report } = await reported([issue(), issue({ number: 43, title: 'Add CSV export', labels: ['enhancement'] })])
    // #then only the bug waits for Aeon
    const bugs = await app.watch.listBugReports()
    expect(bugs).toHaveLength(1)
    expect(bugs[0]).toMatchObject({ issueNumber: 42, status: 'reported', issueAuthor: 'reporter' })
    expect(report.bugsReported).toEqual([bugs[0]!.id])
  })

  it('reads bug labels case-insensitively and tracks an issue once', async () => {
    // #given an issue labeled "Type: Bug"
    const { app, repo } = await reported([issue({ labels: ['Type: Bug'] })])
    // #when the repository is polled again
    const again = await app.work.observe(repo)
    // #then it is not reported twice
    expect(again.bugsReported).toEqual([])
    expect(await app.watch.listBugReports()).toHaveLength(1)
  })

  it('closes a report whose issue was closed before Aeon reproduced it', async () => {
    // #given a reported bug
    const { app, github, repo } = await reported()
    // #when the issue is closed
    github.issues = []
    await app.work.observe(repo)
    // #then
    expect((await app.watch.listBugReports())[0]).toMatchObject({ status: 'closed' })
  })

  it('does not close a report just because its issue fell out of the listing', async () => {
    // #given a reported bug whose issue is still open on GitHub but no longer in the listing
    const { app, github, repo } = await reported()
    github.issues = []
    github.stillOpen.add(42)
    // #when the repository is polled
    await app.work.observe(repo)
    // #then the report keeps waiting for Aeon
    expect((await app.watch.listBugReports())[0]).toMatchObject({ status: 'reported' })
  })

  it('keeps watching CI when the app cannot read issues', async () => {
    // #given GitHub refuses the issues call
    const github = new FakeGitHub()
    github.listOpenIssues = async () => {
      throw new Error('Resource not accessible by integration')
    }
    const app = await makeApp({ github, env: { TARGET_OPEN_TASKS: '0' } })
    github.addRun({ sha: sha('a1'), at: T0 - HOUR, conclusion: 'success' })
    // #when/#then connecting still works
    const { report } = await app.work.connectRepo(REPO, undefined, OPERATOR)
    expect(report).toMatchObject({ newRuns: 1, bugsReported: [] })
  })
})

describe('which jobs judge a bug fix', () => {
  const yaml = `jobs:
  examples:
    steps:
      - run: npm test
  split:
    name: Split tests
    steps:
      - run: npm run test:split
  lint:
    steps:
      - run: npm run lint
`

  it('names the jobs that run the test command, using the name GitHub shows', () => {
    expect(jobsRunning(yaml, 'npm run test:split')).toEqual(['Split tests'])
    expect(jobsRunning(yaml, '  npm test ')).toEqual(['examples'])
  })

  it('finds none for a command the workflow does not run', () => {
    expect(jobsRunning(yaml, 'node --test')).toEqual([])
  })

  it('records them on the reproduced bug', async () => {
    const { finding } = await reproduced()
    expect(finding.bug?.jobs).toEqual([JOB])
  })
})

describe('what Aeon may send about a bug', () => {
  it('only counts a bug as reproduced when the new test fails', () => {
    // #given a test that passed
    const repro = parseReproduction(reproduction({ withTest: 'passed', note: 'The test passes on main; could not trigger it.' }))
    // #then it is not a reproduction
    expect(repro).toMatchObject({ reproduced: false, note: 'The test passes on main; could not trigger it.' })
  })

  it('does not count a failure the suite already had without the new test', () => {
    // #given the suite was red before and the output never mentions the new test
    const repro = parseReproduction(reproduction({ withoutTest: 'failed', failingOutput: 'TypeError in src/other.js' }))
    // #then it proves nothing about this bug
    expect(repro.reproduced).toBe(false)
    expect(repro.note).toMatch(/already failed/)
  })

  it('asks why when the bug did not reproduce', () => {
    expect(() => parseReproduction(reproduction({ reproduced: false }))).toThrow(/note/)
  })

  it.each([['.github/workflows/ci.yml'], ['../outside.test.js'], ['/etc/passwd'], ['test//x.test.js']])('refuses test path %s', (path) => {
    expect(() => parseReproduction(reproduction({ testPath: path }))).toThrow(DomainError)
  })

  it('needs a full commit sha to reproduce on', () => {
    expect(() => parseReproduction(reproduction({ baseSha: 'abc1234' }))).toThrow(/baseSha/)
  })
})

describe('a reproduced bug', () => {
  it('becomes a finding the engineer decides on, carrying the test', async () => {
    // #given a reported bug
    // #when Aeon reproduces it
    const { app, bug, finding } = await reproduced()
    // #then the engineer sees it with Aeon's test and the failing output
    expect(finding).toMatchObject({ status: 'investigated', signature: 'issue:42', stepCommand: 'npm test', firstFailedSha: sha('a1') })
    expect(finding.bug).toMatchObject({ reportId: bug.id, issueNumber: 42, testPath: TEST_PATH, testSha256: reproTestDigest(TEST_CONTENT) })
    expect(finding.investigation?.confidence).toBe('high')
    expect(await app.watch.requireBugReport(bug.id)).toMatchObject({ status: 'reproduced', findingId: finding.id })
  })

  it('lowers confidence when the suite already failed, but the failure names the new test', async () => {
    // #given the suite was red before, and the output points at the new test
    const ctx = await reported()
    const [bug] = await ctx.app.watch.listBugReports()
    const repro = reproduction({ withoutTest: 'failed', failingOutput: `not ok 1 - ${TEST_PATH}: expected 0.333334` })
    // #when
    const { finding } = await ctx.app.work.recordReproduction(bug!.id, parseReproduction(repro), 'aeon')
    // #then
    expect(finding?.investigation?.confidence).toBe('medium')
  })

  it('records why a bug did not reproduce, and can be tried again', async () => {
    // #given a reported bug Aeon could not trigger
    const ctx = await reported()
    const [bug] = await ctx.app.watch.listBugReports()
    const miss = parseReproduction(reproduction({ withTest: 'passed', note: 'split("1", 3) is correct on main.' }))
    const first = await ctx.app.work.recordReproduction(bug!.id, miss, 'aeon')
    expect(first).toMatchObject({ report: { status: 'not_reproduced', note: 'split("1", 3) is correct on main.' }, finding: null })
    // #when a later run reproduces it
    const second = await ctx.app.work.recordReproduction(bug!.id, parseReproduction(reproduction()), 'aeon')
    // #then
    expect(second.report.status).toBe('reproduced')
  })

  it('is not resolved by a green run, since its test is not in the repository yet', async () => {
    // #given a reproduced bug
    const { app, github, repo, finding } = await reproduced()
    // #when main is green
    github.addRun({ sha: sha('b1'), at: T0, conclusion: 'success' })
    await app.work.observe(repo)
    // #then it still waits for the engineer
    expect((await app.watch.requireFinding(finding.id)).status).toBe('investigated')
  })

  it('is never handed to the CI investigation, which would overwrite the test evidence', async () => {
    // #given a reproduced bug
    const { app, finding } = await reproduced()
    // #when/#then Aeon's investigation endpoint refuses it
    await expect(app.work.recordInvestigation(finding.id, finding.investigation!, 'aeon')).rejects.toThrow(/reported bug/)
  })

  it('freezes the test into the work package', async () => {
    const { app, finding } = await reproduced()
    const task = await app.work.externalize(finding.id, externalizeInput(), OPERATOR)
    expect(task.title).toBe('Fix bug #42: split() loses a micro-unit on thirds')
    expect(task.spec.kind === 'ci-fix' && task.spec.reproTest).toMatchObject({
      path: TEST_PATH,
      content: TEST_CONTENT,
      issueNumber: 42,
      sha256: reproTestDigest(TEST_CONTENT),
    })
  })
})

describe('paying for a bug fix', () => {
  it('rejects a fix that does not add the reproducing test', async () => {
    // #given a merged, green PR that only changes the code
    const { app, task } = await claimedBugWork(['src/split.js'])
    // #when verified
    await app.agent.onSubmission(task.id)
    // #then
    const attempt = (await app.tasks.getReceipt(task.id)).attempts[0]
    expect(attempt?.verification).toMatchObject({ valid: false, code: 'REPRO_TEST_MISSING' })
    expect((await app.store.requireTask(task.id)).state).not.toBe('PAID')
  })

  it('rejects a fix that edits the reproducing test', async () => {
    // #given the PR adds the test but weakens it
    const { app, github, task } = await claimedBugWork(['src/split.js', TEST_PATH])
    github.files[TEST_PATH] = TEST_CONTENT.replace("'0.333334'", "'0.333333'")
    // #when verified
    await app.agent.onSubmission(task.id)
    // #then
    const attempt = (await app.tasks.getReceipt(task.id)).attempts[0]
    expect(attempt?.verification).toMatchObject({ valid: false, code: 'REPRO_TEST_MISSING' })
  })

  it('is not blocked by an unrelated job that is red', async () => {
    // #given the test's job passes but another job in the same run fails
    const { app, github, task } = await claimedBugWork(['src/split.js', TEST_PATH])
    github.files[TEST_PATH] = TEST_CONTENT
    const run = github.runs.at(-1)!
    github.jobs.get(run.id)!.push({ id: 1, name: 'parse', status: 'completed', conclusion: 'failure', htmlUrl: `${run.htmlUrl}/job/1`, steps: [] })
    // #when verified
    await app.agent.onSubmission(task.id)
    // #then paid: the bug's own job decides
    expect((await app.store.requireTask(task.id)).state).toBe('PAID')
  })

  it('pays when the test is added unchanged and the workflow passes, and resolves the bug', async () => {
    // #given the PR adds the exact test (copied with Windows line endings) inside the protected test/ directory
    const { app, github, task, finding } = await claimedBugWork(['src/split.js', TEST_PATH])
    github.files[TEST_PATH] = TEST_CONTENT.replace(/\n/g, '  \r\n')
    // #when verified
    await app.agent.onSubmission(task.id)
    // #then paid, and the bug is done
    expect((await app.store.requireTask(task.id)).state).toBe('PAID')
    const verification = (await app.tasks.getReceipt(task.id)).attempts[0]?.verification
    expect(verification).toMatchObject({ valid: true, code: 'CHECKS_PASSED' })
    expect(verification?.reason).toContain('bug #42')
    expect((await app.watch.requireFinding(finding.id)).status).toBe('resolved')
  })
})
