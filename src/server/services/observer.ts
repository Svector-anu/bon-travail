import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import {
  BUG_LABELS,
  REPEAT_THRESHOLD,
  type FindingRecord,
  type FindingStatus,
  type RegressionWindow,
  type RepoRecord,
  type WorkflowRunRecord,
} from '@/domain/findings'
import type { Clock } from '../clock'
import type { GhJob, GhRun, GitHubClient } from '../github/client'
import type { WatchStore } from '../store/watch-store'
import { findingDisplayIdOf as findingDisplayId } from './views'

export interface ObserveReport {
  repoId: string
  newRuns: number
  detected: string[]
  repeated: string[]
  resolved: string[]
  recurred: string[]
  /** Bug reports picked up from issues labeled as bugs. */
  bugsReported: string[]
  notable: string[]
}

/** Findings still failing: a green run on the default branch resolves them. */
const OPEN_STATUSES: readonly FindingStatus[] = ['watching', 'candidate', 'investigated', 'internal', 'externalized', 'recurred']
const EXCERPT_LINES = 40
const EXCERPT_CHARS = 4000
const RUNS_PER_POLL = 30
const MAX_REGRESSION_COMMITS = 20
const ISSUE_BODY_CHARS = 6000

export function isBugIssue(labels: readonly string[]): boolean {
  return labels.some((label) => BUG_LABELS.includes(label.trim().toLowerCase()))
}

export function failureSignature(workflowPath: string, job: string, step: string): string {
  return createHash('sha256').update(`${workflowPath}\n${job}\n${step}`).digest('hex').slice(0, 16)
}

/** Keeps the lines that explain a failure: the ones around the first ##[error], minus timestamps. */
export function errorExcerpt(log: string): string | null {
  const lines = log.split(/\r?\n/).map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ''))
  const firstError = lines.findIndex((line) => line.includes('##[error]'))
  if (firstError === -1) return null
  const window = lines.slice(Math.max(0, firstError - EXCERPT_LINES + 5), firstError + 5)
  const text = window
    .filter((line) => !line.startsWith('##[group]') && !line.startsWith('##[endgroup]'))
    .join('\n')
    .trim()
  return text.length > EXCERPT_CHARS ? text.slice(text.length - EXCERPT_CHARS) : text
}

/** Finds the failing step's `run:` script in the workflow file, so Aeon can reproduce it. */
export function stepCommand(workflowYaml: string, jobName: string, stepName: string): string | null {
  let doc: unknown
  try {
    doc = parseYaml(workflowYaml)
  } catch {
    return null
  }
  const jobs = (doc as { jobs?: Record<string, { name?: string; steps?: { name?: string; run?: string }[] }> })?.jobs
  if (!jobs) return null
  for (const [id, job] of Object.entries(jobs)) {
    const label = job.name ?? id
    if (jobName !== label && jobName !== id && !jobName.startsWith(`${label} (`)) continue
    const step = job.steps?.find((s) => s.name === stepName || (s.run && `Run ${s.run.split('\n')[0]}` === stepName))
    if (step?.run) return step.run.trim()
  }
  return null
}

interface JobFailure {
  job: string
  step: string
  jobId: number
}

/** Every failing job in a run, each with its first failing step, in a stable order. */
function failures(jobs: GhJob[]): JobFailure[] {
  return jobs
    .filter((j) => j.conclusion === 'failure' || j.conclusion === 'timed_out')
    .map((job) => {
      const step = job.steps.find((s) => s.conclusion === 'failure') ?? job.steps.find((s) => s.conclusion === 'timed_out')
      return { job: job.name, step: step?.name ?? '(job setup)', jobId: job.id }
    })
    .sort((a, b) => (a.job === b.job ? a.jobId - b.jobId : a.job < b.job ? -1 : 1))
}

/**
 * Watches one workflow on the default branch of each connected repository.
 * Everything here is computed from GitHub's records; no model is involved.
 * A failure seen twice in a row on the same job and step becomes a candidate
 * finding with its evidence attached: the failing log, the step command, and
 * the commits between the last green run and the first red one.
 */
export class Observer {
  constructor(
    private readonly watch: WatchStore,
    private readonly github: GitHubClient,
    private readonly clock: Clock,
  ) {}

  async poll(repo: RepoRecord, actor: string): Promise<ObserveReport> {
    const report: ObserveReport = {
      repoId: repo.id,
      newRuns: 0,
      detected: [],
      repeated: [],
      resolved: [],
      recurred: [],
      bugsReported: [],
      notable: [],
    }
    const runs = await this.github.listRuns(repo.owner, repo.name, repo.workflowId, {
      branch: repo.defaultBranch,
      status: 'completed',
      perPage: RUNS_PER_POLL,
    })
    const fresh: GhRun[] = []
    for (const run of runs) {
      if (run.event === 'pull_request' || run.event === 'pull_request_target') continue
      if (run.headBranch !== repo.defaultBranch) continue
      if (!(await this.watch.hasRun(run.id))) fresh.push(run)
    }
    fresh.sort((a, b) => a.createdAt - b.createdAt)

    for (const run of fresh) {
      if (run.conclusion === 'success') await this.onGreen(repo, run, actor, report)
      else if (run.conclusion === 'failure' || run.conclusion === 'timed_out') await this.onRed(repo, run, actor, report)
      else await this.record(repo, run, null, null)
      report.newRuns++
    }
    await this.syncBugReports(repo, report)
    await this.watch.markPolled(repo.id, this.clock.now())
    return report
  }

  /**
   * Picks up open issues labeled as bugs, and closes the ones whose issue
   * closed before Aeon got to them. Best effort: an app without the Issues
   * permission still watches CI.
   */
  private async syncBugReports(repo: RepoRecord, report: ObserveReport): Promise<void> {
    let issues
    try {
      issues = (await this.github.listOpenIssues(repo.owner, repo.name)).filter((issue) => isBugIssue(issue.labels))
    } catch {
      return
    }
    const now = this.clock.now()
    for (const issue of issues) {
      const created = await this.watch.insertBugReport({
        repoId: repo.id,
        issueNumber: issue.number,
        issueTitle: issue.title.slice(0, 300),
        issueBody: issue.body.slice(0, ISSUE_BODY_CHARS),
        issueUrl: issue.htmlUrl,
        issueAuthor: issue.author,
        status: 'reported',
        note: null,
        findingId: null,
        reportedAt: issue.createdAt || now,
        createdAt: now,
        updatedAt: now,
      })
      if (!created) continue
      report.bugsReported.push(created.id)
      report.notable.push(`Bug #${issue.number} on ${repo.owner}/${repo.name} is waiting for Aeon to reproduce it: "${issue.title}". ${issue.htmlUrl}`)
    }
    const open = new Set(issues.map((issue) => issue.number))
    for (const tracked of await this.watch.listBugReports({ repoId: repo.id, statuses: ['reported', 'not_reproduced'] })) {
      if (!open.has(tracked.issueNumber)) await this.watch.moveBugReport(tracked.id, ['reported', 'not_reproduced'], 'closed', now)
    }
  }

  private async record(
    repo: RepoRecord,
    run: GhRun,
    failure: { job: string; step: string; signature: string } | null,
    findingId: string | null,
  ): Promise<boolean> {
    const record: WorkflowRunRecord = {
      runId: run.id,
      repoId: repo.id,
      runNumber: run.runNumber,
      headSha: run.headSha,
      headBranch: run.headBranch,
      event: run.event,
      conclusion: run.conclusion ?? 'unknown',
      htmlUrl: run.htmlUrl,
      runCreatedAt: run.createdAt,
      failingJob: failure?.job ?? null,
      failingStep: failure?.step ?? null,
      signature: failure?.signature ?? null,
      findingId,
      observedAt: this.clock.now(),
    }
    return this.watch.insertRun(record)
  }

  private async onGreen(repo: RepoRecord, run: GhRun, actor: string, report: ObserveReport): Promise<void> {
    if (!(await this.record(repo, run, null, null))) return
    const open = await this.watch.listFindings({ repoId: repo.id, statuses: OPEN_STATUSES })
    for (const finding of open) {
      // A bug's test is not in the repository until the fix lands, so a green run says nothing about it.
      if (finding.bug) continue
      if (finding.lastFailedAt >= run.createdAt) continue
      await this.watch.updateFinding({
        findingId: finding.id,
        at: this.clock.now(),
        actor,
        to: 'resolved',
        event: 'resolved',
        detail: { runId: run.id, runUrl: run.htmlUrl, sha: run.headSha },
        patch: { resolvedAt: run.createdAt, resolvedRunId: run.id, resolvedSha: run.headSha },
      })
      report.resolved.push(finding.id)
      report.notable.push(`${findingDisplayId(finding)} on ${repo.owner}/${repo.name} is green again at ${run.headSha.slice(0, 7)}. ${run.htmlUrl}`)
    }
  }

  private async onRed(repo: RepoRecord, run: GhRun, actor: string, report: ObserveReport): Promise<void> {
    const jobs = await this.github.listJobs(repo.owner, repo.name, run.id)
    const failing = failures(jobs)
    const primary = failing[0]
    if (!primary) {
      await this.record(repo, run, null, null)
      return
    }
    const primarySignature = failureSignature(repo.workflowPath, primary.job, primary.step)
    const primaryFinding = await this.watch.findingBySignature(repo.id, primarySignature)
    // The run is stored once; a run seen before has already been counted for every job that failed in it.
    if (!(await this.record(repo, run, { ...primary, signature: primarySignature }, primaryFinding?.id ?? null))) return
    // A run can fail in several jobs at once, and each one is its own finding.
    for (const failure of failing) await this.countFailure(repo, run, failure, failure === primary, actor, report)
  }

  private async countFailure(repo: RepoRecord, run: GhRun, failure: JobFailure, primary: boolean, actor: string, report: ObserveReport): Promise<void> {
    const signature = failureSignature(repo.workflowPath, failure.job, failure.step)
    const existing = await this.watch.findingBySignature(repo.id, signature)
    const now = this.clock.now()

    if (!existing) {
      const seq = await this.watch.nextFindingSeq()
      const finding: FindingRecord = {
        id: `find_${String(seq).padStart(3, '0')}`,
        seq,
        repoId: repo.id,
        signature,
        workflowPath: repo.workflowPath,
        workflowName: repo.workflowName,
        jobName: failure.job,
        stepName: failure.step,
        stepCommand: null,
        errorExcerpt: null,
        failureCount: 1,
        firstFailedRunId: run.id,
        firstFailedSha: run.headSha,
        firstFailedAt: run.createdAt,
        lastFailedRunId: run.id,
        lastFailedAt: run.createdAt,
        lastFailedRunUrl: run.htmlUrl,
        regression: null,
        status: REPEAT_THRESHOLD <= 1 ? 'candidate' : 'watching',
        investigation: null,
        decidedBy: null,
        decidedAt: null,
        taskId: null,
        resolvedAt: null,
        resolvedRunId: null,
        resolvedSha: null,
        recurrenceCount: 0,
        lastRecurrenceAt: null,
        bug: null,
        createdAt: now,
        updatedAt: now,
        version: 0,
      }
      await this.watch.insertFinding(finding, actor, { runId: run.id, runUrl: run.htmlUrl, job: failure.job, step: failure.step })
      if (primary) await this.watch.attachRunToFinding(run.id, finding.id)
      report.detected.push(finding.id)
      if (finding.status === 'candidate') await this.gatherEvidence(repo, finding, failure.jobId, actor)
      return
    }

    const recurring = existing.status === 'resolved' || existing.status === 'dismissed'
    const failureCount = existing.failureCount + 1
    const promote = existing.status === 'watching' && failureCount >= REPEAT_THRESHOLD
    const updated = await this.watch.updateFinding({
      findingId: existing.id,
      at: now,
      actor,
      to: recurring ? 'recurred' : promote ? 'candidate' : undefined,
      event: recurring ? 'recurred' : 'repeated',
      detail: { runId: run.id, runUrl: run.htmlUrl, sha: run.headSha, failureCount: recurring ? 1 : failureCount, totalFailures: failureCount },
      patch: {
        // "in a row" means this episode: a recurrence starts counting again.
        failureCount: recurring ? 1 : failureCount,
        lastFailedRunId: run.id,
        lastFailedAt: run.createdAt,
        lastFailedRunUrl: run.htmlUrl,
        // A recurrence starts a new failure episode: the evidence window and
        // Aeon's reproduction run from the fix's green commit to this red one.
        // The original episode stays in the finding's event history.
        ...(recurring
          ? {
              recurrenceCount: existing.recurrenceCount + 1,
              lastRecurrenceAt: run.createdAt,
              firstFailedRunId: run.id,
              firstFailedSha: run.headSha,
              firstFailedAt: run.createdAt,
            }
          : {}),
      },
    })
    if (recurring) {
      report.recurred.push(existing.id)
      report.notable.push(
        `${findingDisplayId(existing)} came back on ${repo.owner}/${repo.name}: "${existing.jobName} / ${existing.stepName}" failed again at ${run.headSha.slice(0, 7)} after it was fixed at ${existing.resolvedSha?.slice(0, 7) ?? 'an earlier commit'}. ${run.htmlUrl}`,
      )
    } else if (promote) {
      report.repeated.push(existing.id)
      report.notable.push(
        `${findingDisplayId(existing)}: "${existing.jobName} / ${existing.stepName}" failed ${failureCount} times in a row on ${repo.owner}/${repo.name}. Evidence is ready for review.`,
      )
    }
    if (recurring || promote || !updated.errorExcerpt) await this.gatherEvidence(repo, updated, failure.jobId, actor)
  }

  /** Best effort: a missing log or compare never blocks the finding itself. */
  private async gatherEvidence(repo: RepoRecord, finding: FindingRecord, jobId: number, actor: string): Promise<void> {
    const patch: { errorExcerpt?: string | null; stepCommand?: string | null; regression?: RegressionWindow | null } = {}
    try {
      patch.errorExcerpt = errorExcerpt(await this.github.jobLog(repo.owner, repo.name, jobId))
    } catch {
      patch.errorExcerpt = finding.errorExcerpt
    }
    try {
      const yaml = await this.github.fileAt(repo.owner, repo.name, repo.workflowPath, finding.firstFailedSha)
      patch.stepCommand = yaml ? stepCommand(yaml, finding.jobName, finding.stepName) : null
    } catch {
      patch.stepCommand = finding.stepCommand
    }
    patch.regression = await this.regressionWindow(repo, finding).catch(() => finding.regression)
    await this.watch.updateFinding({ findingId: finding.id, at: this.clock.now(), actor, event: 'evidence_gathered', patch })
  }

  private async regressionWindow(repo: RepoRecord, finding: FindingRecord): Promise<RegressionWindow> {
    const green = await this.watch.lastGreenBefore(repo.id, finding.firstFailedAt)
    if (!green) {
      return {
        lastGreenSha: null,
        lastGreenRunUrl: null,
        firstRedSha: finding.firstFailedSha,
        compareUrl: null,
        commits: [],
        files: [],
        truncated: false,
      }
    }
    const compare = await this.github.compare(repo.owner, repo.name, green.headSha, finding.firstFailedSha)
    return {
      lastGreenSha: green.headSha,
      lastGreenRunUrl: green.htmlUrl,
      firstRedSha: finding.firstFailedSha,
      compareUrl: compare.htmlUrl,
      commits: compare.commits.slice(-MAX_REGRESSION_COMMITS),
      files: compare.files.slice(0, 100),
      truncated: compare.totalCommits > MAX_REGRESSION_COMMITS || compare.files.length > 100,
    }
  }
}
