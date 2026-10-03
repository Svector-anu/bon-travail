import { describe, expect, it } from 'vitest'
import type { Address } from '@/domain/types'
import type { ExternalizeInput } from '@/server/services/work-service'
import { parseInvestigation } from '@/server/services/work-service'
import { throttle } from '@/server/throttle'
import { VerificationPendingError } from '@/server/verification/verifier'
import { FakeGitHub, JOB, NAME, OWNER, STEP, WORKFLOW_PATH, sha } from './fake-github'
import { T0, makeApp } from './helpers'

const HOUR = 60 * 60 * 1000
const ADA = 'ada'
const ADA_WALLET: Address = '0x3333333333333333333333333333333333333333'
const MALLORY_WALLET: Address = '0x4444444444444444444444444444444444444444'
const REPO = `${OWNER}/${NAME}`

const INVESTIGATION = {
  summary: 'transfer example prints micro-units since b1',
  rootCause: 'formatAmount was replaced by a raw bigint in src/transfer.ts',
  reproduction: ['git checkout b1', 'npm test'],
  firstBadSha: sha('b1'),
  bisectMethod: 'git bisect run npm test between a1 and b1',
  proposedAcceptance: 'The examples job passes on main after the fix is merged.',
  proposedScope: 'Restore human-readable USDC amounts in src/transfer.ts.',
  suggestedProtectedPaths: ['examples/'],
  confidence: 'high',
  commands: [{ command: 'npm test', sha: sha('b1'), outcome: 'failed', note: null }],
}

function externalizeInput(overrides: Partial<ExternalizeInput> = {}): ExternalizeInput {
  return {
    reward: '0.75',
    deadlineHours: 24,
    contributors: [{ login: ADA, wallet: ADA_WALLET }],
    acceptance: 'The examples job passes on main after the fix is merged.',
    scope: 'Fix the amount formatting in src/transfer.ts.',
    protectedPaths: ['examples/'],
    requireMerge: true,
    ...overrides,
  }
}

/** A repository whose examples job went red twice after a green run. */
async function watched(env: Record<string, string> = {}) {
  const github = new FakeGitHub()
  const app = await makeApp({ github, env: { TARGET_OPEN_TASKS: '0', ...env } })
  github.compareCommits = [{ sha: sha('b1'), message: 'Switch amounts to micro-units', author: 'dev', url: 'https://github.com/x/y/commit/b1' }]
  github.addRun({ sha: sha('a1'), at: T0 - 4 * HOUR, conclusion: 'success' })
  github.addRun({ sha: sha('b1'), at: T0 - 3 * HOUR, conclusion: 'failure' })
  github.addRun({ sha: sha('c1'), at: T0 - 2 * HOUR, conclusion: 'failure' })
  const { repo, report } = await app.work.connectRepo(REPO, undefined, 'owner')
  const finding = (await app.watch.listFindings())[0]!
  return { app, github, repo, report, finding }
}

async function openWork(env: Record<string, string> = {}, input: Partial<ExternalizeInput> = {}) {
  const ctx = await watched(env)
  const task = await ctx.app.work.externalize(ctx.finding.id, externalizeInput(input), 'owner')
  return { ...ctx, task }
}

async function claimedWork(input: Partial<ExternalizeInput> = {}) {
  const ctx = await openWork({}, input)
  const pr = ctx.github.addPull({ number: 7, author: ADA, title: 'WORK-001: restore USDC formatting' })
  await ctx.app.work.claimWithPullRequest(ctx.task.id, pr.htmlUrl)
  return { ...ctx, pr }
}

describe('observing CI', () => {
  it('turns a repeated failure of the same job and step into a candidate with evidence', async () => {
    // #given a green run followed by two red runs
    // #when the repository is connected
    const { report, finding } = await watched()
    // #then one finding, promoted on the second failure, with GitHub's evidence attached
    expect(report.newRuns).toBe(3)
    expect(finding).toMatchObject({ status: 'candidate', jobName: JOB, stepName: STEP, failureCount: 2, workflowPath: WORKFLOW_PATH })
    expect(finding.errorExcerpt).toContain('AssertionError: expected 1.5 USDC')
    expect(finding.stepCommand).toBe('npm test')
    expect(finding.regression).toMatchObject({ lastGreenSha: sha('a1'), firstRedSha: sha('b1') })
    expect(finding.regression?.commits.map((c) => c.message)).toEqual(['Switch amounts to micro-units'])
  })

  it('only watches a single failure, and ignores pull request runs', async () => {
    // #given one red push run and one red PR run
    const github = new FakeGitHub()
    const app = await makeApp({ github })
    github.addRun({ sha: sha('a1'), at: T0 - 2 * HOUR, conclusion: 'failure' })
    github.addRun({ sha: sha('p1'), at: T0 - HOUR, conclusion: 'failure', event: 'pull_request', branch: 'fix' })
    // #when
    await app.work.connectRepo(REPO, undefined, 'owner')
    // #then
    const findings = await app.watch.listFindings()
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ status: 'watching', failureCount: 1 })
  })

  it('does not count a run twice across polls', async () => {
    // #given a connected repository
    const { app, repo, finding } = await watched()
    // #when it is polled again with nothing new
    const report = await app.work.observe(repo)
    // #then
    expect(report.newRuns).toBe(0)
    expect((await app.watch.requireFinding(finding.id)).failureCount).toBe(2)
  })

  it('resolves on a green run, then detects the failure coming back', async () => {
    // #given a candidate finding
    const { app, github, repo, finding } = await watched()
    // #when main goes green
    github.addRun({ sha: sha('d1'), at: T0 - HOUR, conclusion: 'success' })
    const green = await app.work.observe(repo)
    // #then
    expect(green.resolved).toEqual([finding.id])
    expect(await app.watch.requireFinding(finding.id)).toMatchObject({ status: 'resolved', resolvedSha: sha('d1') })
    // #when the same job and step fail again
    github.addRun({ sha: sha('e1'), at: T0 - HOUR / 2, conclusion: 'failure' })
    const back = await app.work.observe(repo)
    // #then it is a recurrence of the same finding, not a new one
    expect(back.recurred).toEqual([finding.id])
    expect(back.notable[0]).toContain('came back')
    expect(await app.watch.requireFinding(finding.id)).toMatchObject({ status: 'recurred', recurrenceCount: 1, failureCount: 1 })
    expect(await app.watch.listFindings()).toHaveLength(1)
  })

  it('starts a new evidence window when a fixed failure comes back', async () => {
    // #given a finding fixed at d1 that fails again at e1
    const { app, github, repo, finding } = await watched()
    github.addRun({ sha: sha('d1'), at: T0 - HOUR, conclusion: 'success' })
    await app.work.observe(repo)
    github.addRun({ sha: sha('e1'), at: T0 - HOUR / 2, conclusion: 'failure' })
    // #when
    await app.work.observe(repo)
    // #then the episode runs from the fix to the new failure
    expect(await app.watch.requireFinding(finding.id)).toMatchObject({
      firstFailedSha: sha('e1'),
      regression: { lastGreenSha: sha('d1'), firstRedSha: sha('e1') },
    })
  })

  it('keeps an append-only history of the finding', async () => {
    // #given a finding
    const { app, finding } = await watched()
    // #when/#then
    await expect(app.store.database.exec(`DELETE FROM finding_events WHERE finding_id = '${finding.id}'`)).rejects.toThrow(/append-only/)
    const types = (await app.watch.listFindingEvents(finding.id)).map((e) => e.type)
    expect(types).toEqual(['detected', 'repeated', 'evidence_gathered'])
  })
})

describe('Aeon investigation', () => {
  it('attaches an investigation to a candidate', async () => {
    // #given a candidate
    const { app, finding } = await watched()
    // #when Aeon reports
    const updated = await app.work.recordInvestigation(finding.id, parseInvestigation(INVESTIGATION, T0), 'aeon:investigator')
    // #then
    expect(updated.status).toBe('investigated')
    expect(updated.investigation).toMatchObject({ author: 'aeon', confidence: 'high', firstBadSha: sha('b1') })
  })

  it('cannot carry money, people or approval', async () => {
    // #given Aeon sends fields it has no authority over
    const parsed = parseInvestigation({ ...INVESTIGATION, reward: '100', contributors: [{ login: 'x' }], approved: true }, T0)
    // #then they are dropped
    expect(parsed).not.toHaveProperty('reward')
    expect(parsed).not.toHaveProperty('contributors')
    expect(parsed).not.toHaveProperty('approved')
  })

  it('rejects a malformed investigation and one for a finding not under investigation', async () => {
    // #given a watching (single failure) finding
    const github = new FakeGitHub()
    const app = await makeApp({ github })
    github.addRun({ sha: sha('a1'), at: T0 - HOUR, conclusion: 'failure' })
    await app.work.connectRepo(REPO, undefined, 'owner')
    const finding = (await app.watch.listFindings())[0]!
    // #when/#then
    expect(() => parseInvestigation({ ...INVESTIGATION, confidence: 'certain' }, T0)).toThrow(/confidence/)
    await expect(
      app.work.recordInvestigation(finding.id, parseInvestigation(INVESTIGATION, T0), 'aeon:investigator'),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('engineer decisions', () => {
  it('externalizes a finding into a funded, open work package', async () => {
    // #given a candidate
    // #when the engineer approves it
    const { app, task, finding } = await openWork()
    // #then
    expect(task).toMatchObject({ kind: 'ci-fix', state: 'OPEN', rewardMicro: 750_000n })
    expect(task.spec).toMatchObject({
      kind: 'ci-fix',
      findingId: finding.id,
      jobName: JOB,
      baseBranch: 'main',
      requireMerge: true,
      contributors: [{ login: ADA, wallet: ADA_WALLET }],
      approvedBy: 'owner',
    })
    expect(task.spec.kind === 'ci-fix' && task.spec.protectedPaths).toEqual(['.github/', WORKFLOW_PATH, 'examples/'])
    expect((await app.store.getPayment(task.id, 'fund'))?.status).toBe('confirmed')
    expect(await app.watch.requireFinding(finding.id)).toMatchObject({ status: 'externalized', taskId: task.id, decidedBy: 'owner' })
  })

  it('refuses a reward above the cap, a bad login, a bad wallet, an empty allowlist and the treasury wallet', async () => {
    // #given a candidate and a known treasury key
    const key = `0x${'11'.repeat(32)}`
    const { app, finding } = await watched({ ARC_PAYER_PRIVATE_KEY: key })
    const treasury = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A'
    const attempt = (input: Partial<ExternalizeInput>) => app.work.externalize(finding.id, externalizeInput(input), 'owner')
    // #when/#then
    await expect(attempt({ reward: '1.01' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(attempt({ reward: '0' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(attempt({ contributors: [{ login: 'not a login', wallet: ADA_WALLET }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(attempt({ contributors: [{ login: ADA, wallet: '0x12' }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(attempt({ contributors: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(attempt({ contributors: [{ login: ADA, wallet: treasury }] })).rejects.toThrow(/treasury/)
    await expect(attempt({ deadlineHours: 0.5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect((await app.watch.requireFinding(finding.id)).status).toBe('candidate')
  })

  it('refuses the escrow contract as a contributor wallet', async () => {
    // #given an escrow address in the configuration
    const escrow = '0xe8165f9eba6f2e26b552146506abd5df05ae4dd8'
    const { app, finding } = await watched({ ARC_ESCROW_ADDRESS: escrow })
    // #when/#then
    await expect(
      app.work.externalize(finding.id, externalizeInput({ contributors: [{ login: ADA, wallet: escrow }] }), 'owner'),
    ).rejects.toThrow(/escrow contract/)
  })

  it('can keep a finding internal or dismiss it, but not externalize a watching one', async () => {
    // #given a candidate
    const { app, finding } = await watched()
    // #when
    const internal = await app.work.keepInternal(finding.id, 'owner')
    // #then
    expect(internal.status).toBe('internal')
    await expect(app.work.dismiss(finding.id, 'owner')).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('contributor claim', () => {
  it('claims with a PR from an approved login, paying only the approved wallet', async () => {
    // #given an open work package and Ada's PR mentioning it
    const { app, task } = await claimedWork()
    // #then
    const claimed = await app.store.requireTask(task.id)
    expect(claimed).toMatchObject({ state: 'CLAIMED', claimant: ADA_WALLET, claimantHandle: ADA, claimExpiresAt: task.deadlineAt })
  })

  it('refuses a PR by someone not on the allowlist', async () => {
    // #given a PR by mallory
    const { app, github, task } = await openWork()
    const pr = github.addPull({ number: 9, author: 'mallory', title: 'WORK-001 fix' })
    // #when/#then
    await expect(app.work.claimWithPullRequest(task.id, pr.htmlUrl)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await app.store.requireTask(task.id)).state).toBe('OPEN')
  })

  it('needs the PR to mention the work package and target the right repo and branch', async () => {
    // #given PRs that miss one requirement each
    const { app, github, task } = await openWork()
    const unmentioned = github.addPull({ number: 10, author: ADA, title: 'fix' })
    const wrongBase = github.addPull({ number: 11, author: ADA, title: 'WORK-001', baseRef: 'develop' })
    // #when/#then
    await expect(app.work.claimWithPullRequest(task.id, unmentioned.htmlUrl)).rejects.toThrow(/Add WORK-001/)
    await expect(app.work.claimWithPullRequest(task.id, wrongBase.htmlUrl)).rejects.toThrow(/must target main/)
    await expect(app.work.claimWithPullRequest(task.id, 'https://github.com/other/repo/pull/1')).rejects.toThrow(/opened against/)
    await expect(app.work.claimWithPullRequest(task.id, 'not a url')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('cannot use the claim to redirect the payout', async () => {
    // #given an approved login with a different wallet asserted by the caller
    const { app, task } = await openWork()
    // #when/#then
    await expect(app.tasks.claimWork(task.id, { login: ADA, wallet: MALLORY_WALLET }, { kind: 'ci-fix', prNumber: 1, prUrl: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('lets the engineer take a stalled claim back', async () => {
    // #given a claimed package
    const { app, task } = await claimedWork()
    // #when
    const released = await app.work.releaseClaim(task.id, 'owner')
    // #then
    expect(released).toMatchObject({ state: 'OPEN', claimant: null, claimantHandle: null })
  })
})

describe('verification by GitHub Actions', () => {
  it('waits for the merge, then pays when the job passes on main', async () => {
    // #given a submitted PR that is not merged yet
    const { app, github, task, pr } = await claimedWork()
    await app.work.submitPullRequest(task.id, pr.htmlUrl)
    // #when/#then it stays submitted while waiting
    await expect(app.tasks.verifySubmission(task.id, 'agent')).rejects.toBeInstanceOf(VerificationPendingError)
    expect((await app.store.requireTask(task.id)).state).toBe('SUBMITTED')
    // #when merged but CI still running
    github.merge(7, sha('m1'))
    github.addRun({ sha: sha('m1'), at: T0 + HOUR, conclusion: null, status: 'in_progress' })
    await expect(app.tasks.verifySubmission(task.id, 'agent')).rejects.toThrow(/in_progress/)
    // #when CI finishes green on the merge commit
    github.runs.pop()
    github.addRun({ sha: sha('m1'), at: T0 + HOUR, conclusion: 'success' })
    await app.agent.onSubmission(task.id)
    // #then paid to the approved wallet, with a sealed receipt
    const paid = await app.store.requireTask(task.id)
    expect(paid.state).toBe('PAID')
    expect(await app.store.getPayment(task.id, 'release')).toMatchObject({ status: 'confirmed', recipient: ADA_WALLET, amountMicro: 750_000n })
    const receipt = await app.tasks.getReceipt(task.id)
    expect(receipt).toMatchObject({ final: true, outcome: 'PAID', worker: ADA_WALLET, workerHandle: ADA, verifier: 'github-actions/v1' })
    expect(receipt.finding).toMatchObject({ jobName: JOB, stepName: STEP, failureCount: 2 })
    const verification = receipt.attempts[0]?.verification
    expect(verification?.kind === 'ci-fix' && verification.evidence).toMatchObject({ merged: true, verifiedSha: sha('m1'), jobConclusion: 'success' })
    expect(receipt.digest).toMatch(/^sha256:/)
  })

  it('rejects a PR that touches a protected path, and reopens the work', async () => {
    // #given Ada's PR also edits the workflow
    const { app, github, task } = await openWork()
    const pr = github.addPull({ number: 12, author: ADA, title: 'WORK-001' }, ['src/transfer.ts', WORKFLOW_PATH])
    await app.work.claimWithPullRequest(task.id, pr.htmlUrl)
    await app.work.submitPullRequest(task.id, pr.htmlUrl)
    // #when
    const verdict = await app.tasks.verifySubmission(task.id, 'agent')
    // #then
    expect(verdict.state).toBe('REJECTED')
    const attempt = (await app.store.listAttempts(task.id))[0]
    expect(attempt?.verification).toMatchObject({ valid: false, code: 'PROTECTED_PATH' })
    expect((await app.tasks.reopenTask(task.id, 'agent')).state).toBe('OPEN')
  })

  it('rejects when the acceptance job fails on the merge commit', async () => {
    // #given a merged PR whose run on main is red
    const { app, github, task, pr } = await claimedWork()
    await app.work.submitPullRequest(task.id, pr.htmlUrl)
    github.merge(7, sha('m2'))
    github.addRun({ sha: sha('m2'), at: T0 + HOUR, conclusion: 'failure' })
    // #when
    const verdict = await app.tasks.verifySubmission(task.id, 'agent')
    // #then
    expect(verdict.state).toBe('REJECTED')
    expect((await app.store.listAttempts(task.id))[0]?.verification).toMatchObject({ code: 'CHECKS_FAILED' })
  })

  it('pays on the PR head when the engineer did not require a merge', async () => {
    // #given a no-merge package and a green pull_request run on the head
    const { app, github, task, pr } = await claimedWork({ requireMerge: false })
    github.addRun({ sha: pr.headSha, at: T0 + HOUR, conclusion: 'success', event: 'pull_request', branch: 'fix' })
    await app.work.submitPullRequest(task.id, pr.htmlUrl)
    // #when
    await app.agent.onSubmission(task.id)
    // #then
    expect((await app.store.requireTask(task.id)).state).toBe('PAID')
  })

  it('treats GitHub being down as a retry, not a failure', async () => {
    // #given a submitted PR and GitHub unavailable
    const { app, github, task, pr } = await claimedWork()
    await app.work.submitPullRequest(task.id, pr.htmlUrl)
    github.down = true
    // #when/#then
    await expect(app.tasks.verifySubmission(task.id, 'agent')).rejects.toThrow(/github down/)
    expect((await app.store.requireTask(task.id)).state).toBe('SUBMITTED')
    expect(await app.store.listAttempts(task.id)).toMatchObject([{ outcome: null }])
  })

  it('fails a submission still pending after the deadline plus grace', async () => {
    // #given a submitted, never-merged PR
    const { app, task, pr } = await claimedWork()
    await app.work.submitPullRequest(task.id, pr.htmlUrl)
    // #when far past the deadline
    app.clock.set(task.deadlineAt + 7 * HOUR)
    const verdict = await app.tasks.verifySubmission(task.id, 'agent')
    // #then
    expect(verdict.state).toBe('REJECTED')
    expect((await app.tasks.reopenTask(task.id, 'agent')).state).toBe('EXPIRED')
  })

  it('pays exactly once however many times settlement runs', async () => {
    // #given a verified fix
    const { app, github, task, pr } = await claimedWork()
    await app.work.submitPullRequest(task.id, pr.htmlUrl)
    github.merge(7, sha('m3'))
    github.addRun({ sha: sha('m3'), at: T0 + HOUR, conclusion: 'success' })
    // #when settlement is triggered repeatedly
    await app.agent.onSubmission(task.id)
    await app.agent.onSubmission(task.id)
    await app.agent.tick('aeon')
    await app.tasks.releasePayment(task.id, 'agent')
    // #then
    expect((await app.store.listPayments(task.id)).filter((p) => p.kind === 'release')).toHaveLength(1)
    expect((await app.store.listEvents(task.id)).filter((e) => e.type === 'paid')).toHaveLength(1)
  })
})

describe('deadline and refund', () => {
  it('refunds an unclaimed package at its deadline and hands the finding back to the engineer', async () => {
    // #given an open package
    const { app, task, finding } = await openWork()
    // #when the deadline passes and the agent ticks
    app.clock.set(task.deadlineAt + 1)
    await app.agent.tick('aeon')
    // #then
    expect((await app.store.requireTask(task.id)).state).toBe('REFUNDED')
    expect(await app.store.getPayment(task.id, 'refund')).toMatchObject({ status: 'confirmed', amountMicro: 750_000n })
    expect(await app.watch.requireFinding(finding.id)).toMatchObject({ status: 'candidate', taskId: null })
    expect((await app.tasks.getReceipt(task.id)).outcome).toBe('REFUNDED')
  })

  it('refunds a claim that never submitted', async () => {
    // #given a claimed package
    const { app, task } = await claimedWork()
    // #when
    app.clock.set(task.deadlineAt + 1)
    await app.agent.tick('aeon')
    // #then
    expect((await app.store.requireTask(task.id)).state).toBe('REFUNDED')
  })
})

describe('agent tick', () => {
  it('observes repositories on the tick and reports what is new', async () => {
    // #given a connected repository with a new failure since the last poll
    const { app, github } = await watched({ OBSERVE_INTERVAL_SECONDS: '0' })
    github.addRun({ sha: sha('z1'), at: T0 - HOUR, conclusion: 'failure', failing: { job: 'lint', step: 'Run oxlint' } })
    // #when
    const report = await app.agent.tick('aeon')
    // #then
    expect(report.actions.map((a) => a.action)).toContain('detect')
    expect(await app.watch.listFindings()).toHaveLength(2)
  })

  it('never creates work packages on its own', async () => {
    // #given a candidate finding and no rail tests configured
    const { app } = await watched({ OBSERVE_INTERVAL_SECONDS: '0' })
    // #when the agent ticks
    await app.agent.tick('aeon')
    // #then nothing was externalized
    expect(await app.store.listTasks()).toHaveLength(0)
  })
})

describe('public endpoint throttle', () => {
  it('lets one call through per key and spacing window', async () => {
    // #given a fresh app
    const app = await makeApp()
    // #when/#then
    await expect(throttle(app, 'claim:task_001')).resolves.toBeUndefined()
    await expect(throttle(app, 'claim:task_001')).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(throttle(app, 'claim:task_002')).resolves.toBeUndefined()
    app.clock.advance(5_001)
    await expect(throttle(app, 'claim:task_001')).resolves.toBeUndefined()
  })
})
