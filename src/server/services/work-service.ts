import { checkAddress } from '@/domain/address'
import {
  INVESTIGABLE,
  NEEDS_DECISION,
  type BugReportRecord,
  type FindingRecord,
  type Investigation,
  type InvestigationCommand,
  type RepoRecord,
} from '@/domain/findings'
import { formatUsdc, parseUsdc } from '@/domain/money'
import { TASK_KIND_CI_FIX, type Address, type CiFixSpec, type CiFixSubmission, type Contributor, type TaskRecord } from '@/domain/types'
import { canFund, requireRepoAccess, type Viewer } from '../access'
import type { TeamFunding } from './team-funding'
import type { Clock } from '../clock'
import { DomainError } from '../errors'
import { reproTestDigest } from '../verification/repro-test'
import { GITHUB_LOGIN, GitHubNotFoundError, parsePullUrl, REPO_SLUG, type GitHubClient } from '../github/client'
import type { WatchStore } from '../store/watch-store'
import { jobsRunning, type Observer, type ObserveReport } from './observer'
import type { TaskService } from './task-service'
import { displayId, findingDisplayIdOf as findingDisplayId, type ReceiptContext } from './views'

/**
 * Why there is nothing to watch. A fork usually has workflows already, but
 * GitHub keeps them off until its owner turns them on, so it gets its own advice.
 */
export function noWorkflowsMessage(slug: string, fork: boolean): string {
  return fork
    ? `${slug} is a fork, and GitHub keeps a fork's workflows off until you turn them on. Open its Actions tab, enable workflows, then watch it.`
    : `${slug} has no GitHub Actions yet. bon travail watches CI runs, so add a workflow that runs your tests, then watch it. The console can fill one in for you.`
}

export interface WorkSettings {
  maxRewardMicro: bigint
  /** The agent's own payer address and the escrow contract: neither can be a contributor wallet. */
  operatorAddress: string | null
  escrowAddress?: string | null
}

const MAX_BONUS_MICRO = 10_000_000_000n

export interface ExternalizeInput {
  reward: string
  deadlineHours: number
  contributors: { login: string; wallet?: string }[]
  /** Anyone on GitHub may take it; the named contributors are then optional. */
  openToAnyone?: boolean
  /** USDC the team will send itself after the fix is paid, on top of the escrowed reward. Optional. */
  bonus?: string
  acceptance: string
  scope: string
  protectedPaths: string[]
  requireMerge: boolean
}

const MIN_DEADLINE_HOURS = 1
const MAX_DEADLINE_HOURS = 30 * 24
const MAX_CONTRIBUTORS = 10
const DEFAULT_PROTECTED = '.github/'
/** "Payout: 0x…" in a PR description names the author's wallet. */
const PAYOUT_LINE = /^\s*payout\s*[:=]\s*(0x[0-9a-fA-F]{40})\b/im

function text(value: unknown, field: string, max: number, min = 1): string {
  if (typeof value !== 'string') throw new DomainError('BAD_REQUEST', `${field} must be text`)
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) {
    throw new DomainError('BAD_REQUEST', `${field} must be ${min}-${max} characters`)
  }
  return trimmed
}

function textList(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new DomainError('BAD_REQUEST', `${field} must be a list`)
  if (value.length > maxItems) throw new DomainError('BAD_REQUEST', `${field} has more than ${maxItems} items`)
  return value.map((item, i) => text(item, `${field}[${i}]`, maxLength))
}

/** Validates what Aeon sends. Aeon can describe the failure; it cannot set money, people or approval. */
export function parseInvestigation(body: Record<string, unknown>, at: number): Investigation {
  const confidence = body.confidence
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') {
    throw new DomainError('BAD_REQUEST', 'confidence must be low, medium or high')
  }
  const commands: InvestigationCommand[] = (Array.isArray(body.commands) ? body.commands : []).slice(0, 30).map((raw, i) => {
    const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const outcome = c.outcome
    if (outcome !== 'failed' && outcome !== 'passed' && outcome !== 'error') {
      throw new DomainError('BAD_REQUEST', `commands[${i}].outcome must be failed, passed or error`)
    }
    return {
      command: text(c.command, `commands[${i}].command`, 500),
      sha: c.sha === undefined || c.sha === null ? null : text(c.sha, `commands[${i}].sha`, 40, 7),
      outcome,
      note: c.note === undefined || c.note === null ? null : text(c.note, `commands[${i}].note`, 500),
    }
  })
  const runUrl = body.runUrl === undefined || body.runUrl === null ? null : text(body.runUrl, 'runUrl', 300)
  if (runUrl && !runUrl.startsWith('https://github.com/')) throw new DomainError('BAD_REQUEST', 'runUrl must be a GitHub URL')
  return {
    author: 'aeon',
    runUrl,
    summary: text(body.summary, 'summary', 1200),
    rootCause: text(body.rootCause, 'rootCause', 2000),
    reproduction: textList(body.reproduction ?? [], 'reproduction', 20, 500),
    firstBadSha: body.firstBadSha ? text(body.firstBadSha, 'firstBadSha', 40, 7) : null,
    bisectMethod: body.bisectMethod ? text(body.bisectMethod, 'bisectMethod', 300) : null,
    proposedAcceptance: text(body.proposedAcceptance, 'proposedAcceptance', 1500),
    proposedScope: text(body.proposedScope, 'proposedScope', 2000),
    suggestedProtectedPaths: textList(body.suggestedProtectedPaths ?? [], 'suggestedProtectedPaths', 20, 200),
    confidence,
    commands,
    submittedAt: at,
  }
}

export type CommandOutcome = 'failed' | 'passed' | 'error'

/** What Aeon sends after trying to reproduce a reported bug with a new test. */
export interface Reproduction {
  reproduced: boolean
  /** Why it could not be reproduced; required when reproduced is false. */
  note: string | null
  testPath: string
  testContent: string
  testCommand: string
  baseSha: string
  withTest: CommandOutcome
  withoutTest: CommandOutcome
  failingOutput: string
  summary: string
  rootCause: string
  proposedScope: string
  confidence: 'low' | 'medium' | 'high'
  runUrl: string | null
}

const MAX_TEST_CHARS = 30_000
const SHA = /^[0-9a-f]{40}$/

function commandOutcome(value: unknown, field: string): CommandOutcome {
  if (value !== 'failed' && value !== 'passed' && value !== 'error') throw new DomainError('BAD_REQUEST', `${field} must be failed, passed or error`)
  return value
}

/** A path inside the repository that is not the CI configuration. */
function testPathOf(value: unknown): string {
  const path = text(value, 'testPath', 200).replace(/^\.\//, '')
  if (path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '') || path.startsWith('.github/')) {
    throw new DomainError('BAD_REQUEST', 'testPath must be a relative path inside the repository, outside .github/')
  }
  return path
}

/** Kept byte for byte: it is the file the fix must add. */
function testContentOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEST_CHARS) {
    throw new DomainError('BAD_REQUEST', `testContent must be 1-${MAX_TEST_CHARS} characters of text`)
  }
  return value
}

/**
 * Validates what Aeon sends about a bug. It can say whether the bug
 * reproduced and hand over the test; it cannot set money, people or approval.
 * A bug only counts as reproduced when the new test makes the suite fail.
 */
export function parseReproduction(body: Record<string, unknown>): Reproduction {
  const confidence = body.confidence
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') {
    throw new DomainError('BAD_REQUEST', 'confidence must be low, medium or high')
  }
  const withTest = commandOutcome(body.withTest, 'withTest')
  const withoutTest = commandOutcome(body.withoutTest, 'withoutTest')
  const testPath = testPathOf(body.testPath)
  const failingOutput = typeof body.failingOutput === 'string' ? body.failingOutput.slice(-4000) : ''
  // When the suite already failed without the new test, only output naming the test shows it is what fails.
  const testIsTheFailure = withoutTest === 'passed' || failingOutput.includes(testPath.split('/').pop()!)
  const reproduced = body.reproduced === true && withTest === 'failed' && testIsTheFailure
  const baseSha = text(body.baseSha, 'baseSha', 40, 40).toLowerCase()
  if (!SHA.test(baseSha)) throw new DomainError('BAD_REQUEST', 'baseSha must be a full commit sha')
  const runUrl = body.runUrl === undefined || body.runUrl === null ? null : text(body.runUrl, 'runUrl', 300)
  if (runUrl && !runUrl.startsWith('https://github.com/')) throw new DomainError('BAD_REQUEST', 'runUrl must be a GitHub URL')
  const note = body.note === undefined || body.note === null || body.note === '' ? null : text(body.note, 'note', 1500)
  if (!reproduced && !note && body.reproduced !== true) throw new DomainError('BAD_REQUEST', 'Say in note why the bug did not reproduce')
  return {
    reproduced,
    note: reproduced
      ? null
      : (note ??
        (withTest !== 'failed'
          ? `The test command ${withTest} with ${testPath} added, so it does not show the bug.`
          : `The suite already failed without ${testPath}, and the failure does not name it, so it is not clear the new test is what fails.`)),
    testPath,
    testContent: testContentOf(body.testContent),
    testCommand: text(body.testCommand, 'testCommand', 500),
    baseSha,
    withTest,
    withoutTest,
    failingOutput,
    summary: text(body.summary, 'summary', 1200),
    rootCause: text(body.rootCause, 'rootCause', 2000),
    proposedScope: text(body.proposedScope, 'proposedScope', 2000),
    confidence,
    runUrl,
  }
}

/**
 * The engineer's side of the product. Aeon and the observer prepare evidence;
 * only an authenticated owner decides what leaves the team, for how much,
 * and to whom. Contributors prove who they are with the pull request itself.
 */
export class WorkService {
  constructor(
    private readonly watch: WatchStore,
    private readonly tasks: TaskService,
    private readonly observer: Observer | null,
    private readonly github: GitHubClient | null,
    private readonly clock: Clock,
    private readonly settings: WorkSettings,
    private readonly funding: Pick<TeamFunding, 'assertCanFund'> | null = null,
  ) {
    tasks.onSettled((task) => this.afterSettlement(task))
    tasks.useReceiptContext((task) => this.receiptContext(task))
  }

  private requireGitHub(): GitHubClient {
    if (!this.github) throw new DomainError('UNAVAILABLE', 'GITHUB_TOKEN is not configured; GitHub features are disabled')
    return this.github
  }

  // ---- repositories --------------------------------------------------------

  async connectRepo(slug: string, workflowPath: string | undefined, viewer: Viewer): Promise<{ repo: RepoRecord; report: ObserveReport }> {
    const gh = this.requireGitHub()
    const match = REPO_SLUG.exec(slug.trim())
    if (!match) throw new DomainError('BAD_REQUEST', 'Repository must look like owner/name')
    const owner = match[1]!
    const name = match[2]!
    requireRepoAccess(viewer, owner, `${owner}/${name}`)
    let found
    try {
      found = await gh.getRepo(owner, name)
    } catch (error) {
      if (error instanceof GitHubNotFoundError) {
        throw new DomainError('NOT_FOUND', `${owner}/${name} is not visible to bon travail. Install the GitHub App on it first.`)
      }
      throw error
    }
    const workflows = (await gh.listWorkflows(found.owner, found.name)).filter((w) => w.state === 'active')
    if (workflows.length === 0) throw new DomainError('BAD_REQUEST', noWorkflowsMessage(`${found.owner}/${found.name}`, found.fork))
    const workflow = workflowPath ? workflows.find((w) => w.path === workflowPath.trim()) : workflows.length === 1 ? workflows[0] : undefined
    if (!workflow) {
      throw new DomainError('BAD_REQUEST', `Pick a workflow to watch: ${workflows.map((w) => w.path).join(', ')}`)
    }
    const repo = await this.watch.upsertRepo({
      id: `${found.owner}/${found.name}`.toLowerCase(),
      owner: found.owner,
      name: found.name,
      defaultBranch: found.defaultBranch,
      workflowPath: workflow.path,
      workflowId: workflow.id,
      workflowName: workflow.name,
      connectedBy: viewer.actor,
      connectedAt: this.clock.now(),
      lastPolledAt: null,
      active: true,
      private: found.private,
    })
    return { repo, report: await this.observe(repo) }
  }

  /** Whoever triggers it, what the observer records is its own reading of GitHub. */
  async observe(repo: RepoRecord): Promise<ObserveReport> {
    if (!this.observer) throw new DomainError('UNAVAILABLE', 'GITHUB_TOKEN is not configured; GitHub features are disabled')
    return this.observer.poll(repo, 'observer')
  }

  // ---- Aeon ----------------------------------------------------------------

  async recordInvestigation(findingId: string, investigation: Investigation, actor: string): Promise<FindingRecord> {
    const finding = await this.watch.requireFinding(findingId)
    if (!INVESTIGABLE.includes(finding.status)) {
      throw new DomainError('CONFLICT', `${findingDisplayId(finding)} is ${finding.status}; there is nothing to investigate`)
    }
    if (finding.bug) throw new DomainError('CONFLICT', `${findingDisplayId(finding)} is a reported bug; Aeon reproduced it with a test already`)
    return this.watch.updateFinding({
      findingId,
      at: this.clock.now(),
      actor,
      from: INVESTIGABLE,
      to: 'investigated',
      event: 'investigated',
      detail: { confidence: investigation.confidence, firstBadSha: investigation.firstBadSha, runUrl: investigation.runUrl },
      patch: { investigation },
    })
  }

  /**
   * Aeon's answer to a bug report. A reproduced bug becomes a finding the
   * engineer decides on like any CI failure, carrying the test that proves it.
   */
  async recordReproduction(reportId: string, repro: Reproduction, actor: string): Promise<{ report: BugReportRecord; finding: FindingRecord | null }> {
    const report = await this.watch.requireBugReport(reportId)
    const open = ['reported', 'not_reproduced'] as const
    if (!(open as readonly string[]).includes(report.status)) {
      throw new DomainError('CONFLICT', `${report.id} is ${report.status}; there is nothing to reproduce`)
    }
    const now = this.clock.now()
    if (!repro.reproduced) {
      return { report: await this.watch.moveBugReport(report.id, open, 'not_reproduced', now, { note: repro.note }), finding: null }
    }

    const repo = await this.watch.requireRepo(report.repoId)
    // The fix is judged by the jobs that run Aeon's test, so unrelated red jobs cannot block the payout.
    const workflowYaml = await this.github?.fileAt(repo.owner, repo.name, repo.workflowPath, repro.baseSha).catch(() => null)
    const jobs = workflowYaml ? jobsRunning(workflowYaml, repro.testCommand) : []
    const seq = await this.watch.nextFindingSeq()
    const runUrl = repro.runUrl ?? report.issueUrl
    const alreadyRed = repro.withoutTest !== 'passed'
    const finding: FindingRecord = {
      id: `find_${String(seq).padStart(3, '0')}`,
      seq,
      repoId: repo.id,
      signature: `issue:${report.issueNumber}`,
      workflowPath: repo.workflowPath,
      workflowName: repo.workflowName,
      jobName: `bug #${report.issueNumber}`,
      stepName: report.issueTitle,
      stepCommand: repro.testCommand,
      errorExcerpt: repro.failingOutput || null,
      failureCount: 1,
      firstFailedRunId: 0,
      firstFailedSha: repro.baseSha,
      firstFailedAt: now,
      lastFailedRunId: 0,
      lastFailedAt: now,
      lastFailedRunUrl: runUrl,
      regression: null,
      status: 'investigated',
      investigation: {
        author: 'aeon',
        runUrl: repro.runUrl,
        summary: repro.summary,
        rootCause: repro.rootCause,
        reproduction: [`Add ${repro.testPath}`, repro.testCommand],
        firstBadSha: null,
        bisectMethod: null,
        proposedAcceptance: `${jobs.length > 0 ? jobs.map((j) => `"${j}"`).join(', ') : repo.workflowName} passes with ${repro.testPath} added unchanged.`,
        proposedScope: repro.proposedScope,
        suggestedProtectedPaths: [],
        // A suite that already failed without the test proves less about this bug.
        confidence: alreadyRed && repro.confidence === 'high' ? 'medium' : repro.confidence,
        commands: [
          { command: repro.testCommand, sha: repro.baseSha, outcome: repro.withTest, note: `with ${repro.testPath}` },
          { command: repro.testCommand, sha: repro.baseSha, outcome: repro.withoutTest, note: 'without the new test' },
        ],
        submittedAt: now,
      },
      decidedBy: null,
      decidedAt: null,
      taskId: null,
      resolvedAt: null,
      resolvedRunId: null,
      resolvedSha: null,
      recurrenceCount: 0,
      lastRecurrenceAt: null,
      bug: {
        reportId: report.id,
        issueNumber: report.issueNumber,
        issueTitle: report.issueTitle,
        issueUrl: report.issueUrl,
        testPath: repro.testPath,
        testContent: repro.testContent,
        testSha256: reproTestDigest(repro.testContent),
        testCommand: repro.testCommand,
        jobs,
        baseSha: repro.baseSha,
      },
      createdAt: now,
      updatedAt: now,
      version: 0,
    }
    await this.watch.insertFinding(finding, actor, { issueNumber: report.issueNumber, issueUrl: report.issueUrl, testPath: repro.testPath })
    const moved = await this.watch.moveBugReport(report.id, open, 'reproduced', now, { findingId: finding.id, note: null })
    return { report: moved, finding: await this.watch.requireFinding(finding.id) }
  }

  // ---- engineer decisions --------------------------------------------------

  /** The finding, if the viewer's team owns its repository; NOT_FOUND otherwise, so teams cannot probe each other. */
  private async findingFor(findingId: string, viewer: Viewer): Promise<{ finding: FindingRecord; repo: RepoRecord }> {
    const finding = await this.watch.getFinding(findingId)
    const repo = finding ? await this.watch.getRepo(finding.repoId) : null
    if (!finding || !repo) throw new DomainError('NOT_FOUND', `finding ${findingId} not found`)
    requireRepoAccess(viewer, repo.owner, `finding ${findingId}`)
    return { finding, repo }
  }

  async keepInternal(findingId: string, viewer: Viewer): Promise<FindingRecord> {
    await this.findingFor(findingId, viewer)
    const actor = viewer.actor
    return this.watch.updateFinding({
      findingId,
      at: this.clock.now(),
      actor,
      from: NEEDS_DECISION,
      to: 'internal',
      event: 'kept_internal',
      patch: { decidedBy: actor, decidedAt: this.clock.now() },
    })
  }

  async dismiss(findingId: string, viewer: Viewer): Promise<FindingRecord> {
    await this.findingFor(findingId, viewer)
    const actor = viewer.actor
    return this.watch.updateFinding({
      findingId,
      at: this.clock.now(),
      actor,
      from: NEEDS_DECISION,
      to: 'dismissed',
      event: 'dismissed',
      patch: { decidedBy: actor, decidedAt: this.clock.now() },
    })
  }

  /**
   * Turns a finding into a funded work package. The engineer sets the reward,
   * deadline, allowlist, acceptance condition and scope; the workflow file and
   * .github/ are always protected so a fix cannot pass by editing the judge.
   */
  async externalize(findingId: string, raw: ExternalizeInput, viewer: Viewer): Promise<TaskRecord> {
    const { finding, repo } = await this.findingFor(findingId, viewer)
    const actor = viewer.actor
    if (![...NEEDS_DECISION, 'internal'].includes(finding.status)) {
      throw new DomainError('CONFLICT', `${findingDisplayId(finding)} is ${finding.status} and cannot be externalized`)
    }
    if (!canFund(viewer, repo.owner)) {
      throw new DomainError('FORBIDDEN', `Only an admin of ${repo.owner} on GitHub can put money behind this work`)
    }
    const input = this.validateExternalize(raw, finding)
    // Operators fund from the treasury directly; a team pays only from its own deposits and sponsorship.
    if (!viewer.operator) {
      if (!this.funding) throw new DomainError('UNAVAILABLE', 'Team funding is not set up in this deployment')
      await this.funding.assertCanFund(repo.owner, input.rewardMicro)
    }

    const now = this.clock.now()
    const spec: CiFixSpec = {
      kind: TASK_KIND_CI_FIX,
      findingId,
      repo: { owner: repo.owner, name: repo.name },
      baseBranch: repo.defaultBranch,
      workflowPath: finding.workflowPath,
      workflowName: finding.workflowName,
      jobName: finding.jobName,
      acceptance: input.acceptance,
      scope: input.scope,
      protectedPaths: input.protectedPaths,
      requireMerge: input.requireMerge,
      contributors: input.contributors,
      openToAnyone: input.openToAnyone,
      ...(input.bonusUsdc ? { bonusUsdc: input.bonusUsdc } : {}),
      ...(finding.bug
        ? {
            reproTest: {
              path: finding.bug.testPath,
              content: finding.bug.testContent,
              sha256: finding.bug.testSha256,
              command: finding.bug.testCommand,
              jobs: finding.bug.jobs,
              issueNumber: finding.bug.issueNumber,
              issueTitle: finding.bug.issueTitle,
              issueUrl: finding.bug.issueUrl,
            },
          }
        : {}),
      approvedBy: actor,
    }
    const task = await this.tasks.createWorkTask(
      {
        title: finding.bug ? `Fix bug #${finding.bug.issueNumber}: ${finding.bug.issueTitle}` : `Fix the failing "${finding.stepName}" step in ${finding.jobName}`,
        description: input.scope,
        rewardMicro: input.rewardMicro,
        subject: `finding:${findingId}:${now}`,
        spec,
        deadlineAt: now + input.deadlineHours * 60 * 60 * 1000,
      },
      actor,
    )
    await this.watch.updateFinding({
      findingId,
      at: now,
      actor,
      to: 'externalized',
      event: 'externalized',
      detail: {
        taskId: task.id,
        reward: formatUsdc(input.rewardMicro),
        contributors: input.contributors.map((c) => c.login),
        openToAnyone: input.openToAnyone,
        bonus: input.bonusUsdc,
      },
      patch: { taskId: task.id, decidedBy: actor, decidedAt: now },
    })
    const funded = await this.tasks.fundTask(task.id, actor)
    return this.tasks.publishTask(funded.id, actor)
  }

  private validateExternalize(raw: ExternalizeInput, finding: FindingRecord) {
    const rewardMicro = parseUsdc(String(raw.reward ?? ''))
    if (rewardMicro === null || rewardMicro <= 0n) throw new DomainError('BAD_REQUEST', 'Reward must be a positive USDC amount')
    if (rewardMicro > this.settings.maxRewardMicro) {
      throw new DomainError('BAD_REQUEST', `Reward is above the per-task cap of ${formatUsdc(this.settings.maxRewardMicro)} USDC`)
    }
    const deadlineHours = Number(raw.deadlineHours)
    if (!Number.isFinite(deadlineHours) || deadlineHours < MIN_DEADLINE_HOURS || deadlineHours > MAX_DEADLINE_HOURS) {
      throw new DomainError('BAD_REQUEST', `Deadline must be between ${MIN_DEADLINE_HOURS} hour and ${MAX_DEADLINE_HOURS / 24} days`)
    }
    const bonusUsdc = this.bonus(raw.bonus)
    const openToAnyone = raw.openToAnyone === true
    const listed = Array.isArray(raw.contributors) ? raw.contributors : []
    if ((!openToAnyone && listed.length === 0) || listed.length > MAX_CONTRIBUTORS) {
      throw new DomainError('BAD_REQUEST', openToAnyone ? `Name at most ${MAX_CONTRIBUTORS} people` : `Open it to anyone, or name between 1 and ${MAX_CONTRIBUTORS} people`)
    }
    const seen = new Set<string>()
    const contributors: Contributor[] = listed.map((c, i) => {
      const login = text(c?.login, `contributors[${i}].login`, 39).replace(/^@/, '')
      if (!GITHUB_LOGIN.test(login)) throw new DomainError('BAD_REQUEST', `"${login}" is not a GitHub login`)
      if (seen.has(login.toLowerCase())) throw new DomainError('BAD_REQUEST', `@${login} is listed twice`)
      seen.add(login.toLowerCase())
      const rawWallet = String(c?.wallet ?? '').trim()
      if (!rawWallet) return { login, wallet: null }
      return { login, wallet: this.payoutWallet(rawWallet, `Wallet for @${login}`) }
    })
    const protectedPaths = [
      ...new Set([
        DEFAULT_PROTECTED,
        finding.workflowPath,
        ...(Array.isArray(raw.protectedPaths) ? raw.protectedPaths : [])
          .map((p) => String(p).trim().replace(/^\.?\//, ''))
          .filter((p) => p.length > 0 && p.length <= 200),
      ]),
    ].slice(0, 30)
    return {
      rewardMicro,
      deadlineHours,
      contributors,
      openToAnyone,
      bonusUsdc,
      acceptance: text(raw.acceptance, 'Acceptance condition', 1500),
      scope: text(raw.scope, 'Scope', 4000),
      protectedPaths,
      requireMerge: raw.requireMerge !== false,
    }
  }

  /** The team's own top-up. It never touches escrow, so it is only bounded to catch typos. */
  private bonus(raw: unknown): string | null {
    const value = String(raw ?? '').trim()
    if (!value) return null
    const micro = parseUsdc(value)
    if (micro === null || micro < 0n) throw new DomainError('BAD_REQUEST', 'Bonus must be a USDC amount')
    if (micro > MAX_BONUS_MICRO) throw new DomainError('BAD_REQUEST', `Bonus is above ${formatUsdc(MAX_BONUS_MICRO)} USDC`)
    return micro === 0n ? null : formatUsdc(micro)
  }

  private walletFromPullBody(body: string): Address {
    const line = PAYOUT_LINE.exec(body)
    if (!line) throw new DomainError('BAD_REQUEST', 'Add a line "Payout: 0x…" with your wallet to the PR description, then claim again')
    return this.payoutWallet(line[1]!, 'The payout wallet in the PR description')
  }

  /** A wallet a reward may be paid to: well formed, and never the treasury or the escrow itself. */
  private payoutWallet(raw: string, label: string): Address {
    const wallet = checkAddress(raw)
    if (!wallet.ok) throw new DomainError('BAD_REQUEST', `${label} ${wallet.reason}`)
    if (this.settings.operatorAddress && wallet.address.toLowerCase() === this.settings.operatorAddress.toLowerCase()) {
      throw new DomainError('BAD_REQUEST', 'The agent treasury cannot be a payout wallet')
    }
    if (this.settings.escrowAddress && wallet.address.toLowerCase() === this.settings.escrowAddress.toLowerCase()) {
      throw new DomainError('BAD_REQUEST', 'The escrow contract cannot be a payout wallet')
    }
    return wallet.address
  }

  async releaseClaim(taskId: string, viewer: Viewer): Promise<TaskRecord> {
    const task = await this.tasks.getTask(taskId)
    if (!task || task.spec.kind !== TASK_KIND_CI_FIX) throw new DomainError('NOT_FOUND', `task ${taskId} not found`)
    requireRepoAccess(viewer, task.spec.repo.owner, `task ${taskId}`)
    return this.tasks.releaseClaim(taskId, viewer.actor)
  }

  // ---- contributor flow ----------------------------------------------------

  /**
   * Proves the claim from GitHub: the PR must be in the task's repository,
   * target its base branch, mention the work package, and be authored by an
   * approved login. The payout wallet comes from the allowlist, not the request.
   */
  async claimWithPullRequest(taskId: string, prUrl: string): Promise<TaskRecord> {
    const { task, spec, pr, submission } = await this.loadPull(taskId, prUrl)
    if (pr.state !== 'open') throw new DomainError('BAD_REQUEST', `PR #${pr.number} is ${pr.merged ? 'already merged' : 'closed'}; claim with an open PR`)
    const named = spec.contributors.find((c) => c.login.toLowerCase() === pr.author.toLowerCase())
    if (!named && !spec.openToAnyone) {
      throw new DomainError('FORBIDDEN', `@${pr.author} is not approved for ${displayId(task)}. The engineer controls who can take this work.`)
    }
    const mention = displayId(task)
    if (!`${pr.title}\n${pr.body}`.toUpperCase().includes(mention)) {
      throw new DomainError('BAD_REQUEST', `Add ${mention} to the PR title or description so the claim is tied to this work package`)
    }
    // The payout comes from the engineer's list, or from the PR description, which only its author
    // (and the repository's maintainers) can write. Never from the claim request itself.
    const wallet = named?.wallet ?? this.walletFromPullBody(pr.body ?? '')
    return this.tasks.claimWork(taskId, { login: pr.author, wallet }, submission)
  }

  /** Hands the claimed PR to the verifier. Safe for anyone to trigger: only the claimant can be paid. */
  async submitPullRequest(taskId: string, prUrl: string): Promise<TaskRecord> {
    const { task, pr, submission } = await this.loadPull(taskId, prUrl)
    if (!task.claimantHandle || pr.author.toLowerCase() !== task.claimantHandle.toLowerCase()) {
      throw new DomainError('FORBIDDEN', `PR #${pr.number} is not by the contributor holding the claim`)
    }
    return this.tasks.submitWork(taskId, submission, `contributor:${task.claimantHandle}`)
  }

  private async loadPull(taskId: string, prUrl: string) {
    const gh = this.requireGitHub()
    const task = await this.tasks.requireTask(taskId)
    if (task.spec.kind !== TASK_KIND_CI_FIX) throw new DomainError('BAD_REQUEST', `${taskId} is not a work package`)
    const spec = task.spec
    const parsed = parsePullUrl(prUrl)
    if (!parsed) throw new DomainError('BAD_REQUEST', 'Paste a pull request link like https://github.com/owner/repo/pull/12')
    if (`${parsed.owner}/${parsed.name}`.toLowerCase() !== `${spec.repo.owner}/${spec.repo.name}`.toLowerCase()) {
      throw new DomainError('BAD_REQUEST', `The PR must be opened against ${spec.repo.owner}/${spec.repo.name}`)
    }
    let pr
    try {
      pr = await gh.getPull(spec.repo.owner, spec.repo.name, parsed.number)
    } catch (error) {
      if (error instanceof GitHubNotFoundError) throw new DomainError('NOT_FOUND', `PR #${parsed.number} does not exist`)
      throw error
    }
    if (pr.baseRef !== spec.baseBranch) throw new DomainError('BAD_REQUEST', `PR #${pr.number} must target ${spec.baseBranch}`)
    const submission: CiFixSubmission = { kind: TASK_KIND_CI_FIX, prNumber: pr.number, prUrl: pr.htmlUrl }
    return { task, spec, pr, submission }
  }

  // ---- settlement ----------------------------------------------------------

  /**
   * A refunded package hands the finding back to the engineer. A paid CI fix
   * stays watched for recurrence; a paid bug is resolved, since its test now
   * lives in the repository and CI guards it from here on.
   */
  private async afterSettlement(task: TaskRecord): Promise<void> {
    if (task.spec.kind !== TASK_KIND_CI_FIX) return
    const finding = await this.watch.getFinding(task.spec.findingId)
    if (!finding || finding.status !== 'externalized' || finding.taskId !== task.id) return
    if (task.state === 'PAID' && finding.bug) {
      await this.watch.updateFinding({
        findingId: finding.id,
        at: this.clock.now(),
        actor: 'proofwork',
        to: 'resolved',
        event: 'resolved',
        detail: { taskId: task.id, reason: 'fix paid with the reproducing test merged' },
        patch: { resolvedAt: this.clock.now() },
      })
      return
    }
    if (task.state !== 'REFUNDED') return
    await this.watch.updateFinding({
      findingId: finding.id,
      at: this.clock.now(),
      actor: 'proofwork',
      to: 'candidate',
      event: 'returned',
      detail: { taskId: task.id, reason: 'work package refunded' },
      patch: { taskId: null },
    })
  }

  private async receiptContext(task: TaskRecord): Promise<ReceiptContext | null> {
    if (task.spec.kind !== TASK_KIND_CI_FIX) return null
    const finding = await this.watch.getFinding(task.spec.findingId)
    if (!finding) return null
    return {
      finding: {
        id: finding.id,
        displayId: findingDisplayId(finding),
        repo: `${task.spec.repo.owner}/${task.spec.repo.name}`,
        workflowName: finding.workflowName,
        workflowPath: finding.workflowPath,
        jobName: finding.jobName,
        stepName: finding.stepName,
        failureCount: finding.failureCount,
        firstFailedAt: finding.firstFailedAt,
        firstFailedSha: finding.firstFailedSha,
        lastFailedRunUrl: finding.lastFailedRunUrl,
        errorExcerpt: finding.errorExcerpt ? finding.errorExcerpt.slice(-1500) : null,
        regression: finding.regression
          ? { ...finding.regression, commits: finding.regression.commits.slice(-10), files: finding.regression.files.slice(0, 20) }
          : null,
      },
      investigation: finding.investigation
        ? {
            summary: finding.investigation.summary,
            rootCause: finding.investigation.rootCause,
            firstBadSha: finding.investigation.firstBadSha,
            confidence: finding.investigation.confidence,
            runUrl: finding.investigation.runUrl,
          }
        : null,
    }
  }
}
