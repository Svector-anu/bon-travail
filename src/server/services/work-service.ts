import { checkAddress } from '@/domain/address'
import {
  INVESTIGABLE,
  NEEDS_DECISION,
  type FindingRecord,
  type Investigation,
  type InvestigationCommand,
  type RepoRecord,
} from '@/domain/findings'
import { formatUsdc, parseUsdc } from '@/domain/money'
import { TASK_KIND_CI_FIX, type Address, type CiFixSpec, type CiFixSubmission, type Contributor, type TaskRecord } from '@/domain/types'
import type { Clock } from '../clock'
import { DomainError } from '../errors'
import { GITHUB_LOGIN, GitHubNotFoundError, parsePullUrl, REPO_SLUG, type GitHubClient } from '../github/client'
import type { WatchStore } from '../store/watch-store'
import type { Observer, ObserveReport } from './observer'
import type { TaskService } from './task-service'
import { displayId, findingDisplayIdOf as findingDisplayId, type ReceiptContext } from './views'

/**
 * Why there is nothing to watch. A fork usually has workflows already, but
 * GitHub keeps them off until its owner turns them on, so it gets its own advice.
 */
export function noWorkflowsMessage(slug: string, fork: boolean): string {
  return fork
    ? `${slug} is a fork, and GitHub keeps a fork's workflows off until you turn them on. Open its Actions tab, enable workflows, then watch it.`
    : `${slug} has no GitHub Actions yet. bon travail watches CI runs, so add a workflow (for example one that runs your tests), then watch it.`
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
  ) {
    tasks.onSettled((task) => this.afterSettlement(task))
    tasks.useReceiptContext((task) => this.receiptContext(task))
  }

  private requireGitHub(): GitHubClient {
    if (!this.github) throw new DomainError('UNAVAILABLE', 'GITHUB_TOKEN is not configured; GitHub features are disabled')
    return this.github
  }

  // ---- repositories --------------------------------------------------------

  async connectRepo(slug: string, workflowPath: string | undefined, actor: string): Promise<{ repo: RepoRecord; report: ObserveReport }> {
    const gh = this.requireGitHub()
    const match = REPO_SLUG.exec(slug.trim())
    if (!match) throw new DomainError('BAD_REQUEST', 'Repository must look like owner/name')
    const owner = match[1]!
    const name = match[2]!
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
      connectedBy: actor,
      connectedAt: this.clock.now(),
      lastPolledAt: null,
      active: true,
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

  // ---- engineer decisions --------------------------------------------------

  async keepInternal(findingId: string, actor: string): Promise<FindingRecord> {
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

  async dismiss(findingId: string, actor: string): Promise<FindingRecord> {
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
  async externalize(findingId: string, raw: ExternalizeInput, actor: string): Promise<TaskRecord> {
    const finding = await this.watch.requireFinding(findingId)
    if (![...NEEDS_DECISION, 'internal'].includes(finding.status)) {
      throw new DomainError('CONFLICT', `${findingDisplayId(finding)} is ${finding.status} and cannot be externalized`)
    }
    const repo = await this.watch.requireRepo(finding.repoId)
    const input = this.validateExternalize(raw, finding)

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
      approvedBy: actor,
    }
    const task = await this.tasks.createWorkTask(
      {
        title: `Fix the failing "${finding.stepName}" step in ${finding.jobName}`,
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

  async releaseClaim(taskId: string, actor: string): Promise<TaskRecord> {
    return this.tasks.releaseClaim(taskId, actor)
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

  /** A refunded package hands the finding back to the engineer; a paid one stays watched for recurrence. */
  private async afterSettlement(task: TaskRecord): Promise<void> {
    if (task.spec.kind !== TASK_KIND_CI_FIX || task.state !== 'REFUNDED') return
    const finding = await this.watch.getFinding(task.spec.findingId)
    if (!finding || finding.status !== 'externalized' || finding.taskId !== task.id) return
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
