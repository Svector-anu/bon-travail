import {
  TASK_KIND_CI_FIX,
  type CiEvidence,
  type CiFixSpec,
  type CiFixVerification,
  type Submission,
  type TaskRecord,
} from '@/domain/types'
import type { Clock } from '../clock'
import { GitHubNotFoundError, GitHubUnavailableError, type GhJob, type GhRun, type GitHubClient } from '../github/client'
import { VerificationPendingError, VerificationUnavailableError, type TaskVerifier } from './verifier'

export const CI_VERIFIER_NAME = 'github-actions/v1'

/** GitHub stops listing a PR's files at 3000; past that the protected-path check cannot be trusted. */
const MAX_VERIFIABLE_FILES = 3000

/** True when a path is one of the protected paths, or inside a protected directory ("dir/"). */
export function isProtected(file: string, protectedPaths: readonly string[]): boolean {
  return protectedPaths.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p))
}

function workflowFile(spec: CiFixSpec): string {
  return spec.workflowPath.split('/').pop() ?? spec.workflowPath
}

/** Matrix jobs are named "job (a, b)"; every leg of the acceptance job must pass. */
function acceptanceJobs(jobs: GhJob[], jobName: string): GhJob[] {
  return jobs.filter((job) => job.name === jobName || job.name.startsWith(`${jobName} (`))
}

function latest(runs: GhRun[]): GhRun | null {
  return [...runs].sort((a, b) => b.createdAt - a.createdAt || b.runAttempt - a.runAttempt)[0] ?? null
}

/**
 * Decides a work package from GitHub's own records, never from anything the
 * contributor or the browser says:
 * - the PR targets the task's repository and base branch
 * - it was opened by the contributor holding the claim
 * - it does not touch a protected path (the workflow, the acceptance test)
 * - the acceptance job of the watched workflow passed on the exact commit:
 *   the merge commit on the base branch when merge is required, otherwise
 *   the PR head
 * Anything not decided yet is pending, not failed, until the grace period
 * after the deadline runs out.
 */
export class CiFixVerifier implements TaskVerifier {
  readonly kind = TASK_KIND_CI_FIX
  readonly name = CI_VERIFIER_NAME

  constructor(
    private readonly github: GitHubClient | null,
    private readonly clock: Clock,
    private readonly graceMs: number,
  ) {}

  async verify(task: TaskRecord, submission: Submission): Promise<CiFixVerification> {
    if (task.spec.kind !== TASK_KIND_CI_FIX || submission.kind !== TASK_KIND_CI_FIX) {
      throw new Error(`${this.name} cannot verify a ${task.kind} task`)
    }
    if (!this.github) throw new VerificationUnavailableError('GITHUB_TOKEN is not configured')
    try {
      return await this.decide(task, task.spec, submission.prNumber)
    } catch (error) {
      if (error instanceof GitHubUnavailableError || error instanceof GitHubNotFoundError) {
        throw new VerificationUnavailableError(error.message, { cause: error })
      }
      if (error instanceof VerificationPendingError && this.clock.now() > task.deadlineAt + this.graceMs) {
        return this.verdict(false, 'CHECKS_FAILED', `No verdict by the deadline plus grace period: ${error.message}.`, {
          ...this.emptyEvidence(task, submission.prNumber),
        })
      }
      throw error
    }
  }

  private async decide(task: TaskRecord, spec: CiFixSpec, prNumber: number): Promise<CiFixVerification> {
    const gh = this.github!
    const { owner, name } = spec.repo
    const pr = await gh.getPull(owner, name, prNumber)
    const evidence: CiEvidence = {
      ...this.emptyEvidence(task, prNumber),
      prUrl: pr.htmlUrl,
      author: pr.author,
      headSha: pr.headSha,
      merged: pr.merged,
      mergeSha: pr.mergeSha,
    }

    if (pr.baseRepo.toLowerCase() !== `${owner}/${name}`.toLowerCase() || pr.baseRef !== spec.baseBranch) {
      return this.verdict(false, 'WRONG_TARGET', `PR #${pr.number} does not target ${owner}/${name}@${spec.baseBranch}.`, evidence)
    }
    if (!task.claimantHandle || pr.author.toLowerCase() !== task.claimantHandle.toLowerCase()) {
      return this.verdict(false, 'WRONG_AUTHOR', `PR #${pr.number} was opened by @${pr.author}, not the claimant.`, evidence)
    }

    const files = await gh.listPullFiles(owner, name, prNumber)
    evidence.filesChecked = files.length
    if (files.length >= MAX_VERIFIABLE_FILES) {
      return this.verdict(false, 'PROTECTED_PATH', `PR #${pr.number} is too large to check its protected paths.`, evidence)
    }
    const touched = [...new Set(files.filter((f) => isProtected(f, spec.protectedPaths)))]
    evidence.protectedTouched = touched
    if (touched.length > 0) {
      return this.verdict(false, 'PROTECTED_PATH', `PR #${pr.number} changes protected ${touched.length === 1 ? 'path' : 'paths'} ${touched.join(', ')}.`, evidence)
    }

    let sha: string
    let event: string
    if (spec.requireMerge) {
      if (!pr.merged) {
        if (pr.state === 'closed') {
          return this.verdict(false, 'CLOSED_UNMERGED', `PR #${pr.number} was closed without being merged.`, evidence)
        }
        throw new VerificationPendingError(`waiting for a maintainer to merge PR #${pr.number}`)
      }
      sha = pr.mergeSha!
      event = 'push'
    } else {
      sha = pr.headSha
      event = 'pull_request'
    }
    evidence.verifiedSha = sha

    const runs = await gh.listRuns(owner, name, workflowFile(spec), { headSha: sha, event, perPage: 20 })
    const run = latest(runs.filter((r) => r.headSha === sha && r.path.endsWith(spec.workflowPath)))
    if (!run) throw new VerificationPendingError(`${spec.workflowName} has not run on ${sha.slice(0, 7)} yet`)
    evidence.runId = run.id
    evidence.runUrl = run.htmlUrl
    evidence.runConclusion = run.conclusion
    if (run.status !== 'completed') throw new VerificationPendingError(`${spec.workflowName} run #${run.runNumber} is ${run.status}`)

    const jobs = acceptanceJobs(await gh.listJobs(owner, name, run.id), spec.jobName)
    evidence.jobName = spec.jobName
    evidence.jobUrl = jobs[0]?.htmlUrl ?? null
    if (jobs.length === 0) {
      return this.verdict(false, 'CHECKS_FAILED', `The acceptance job "${spec.jobName}" did not run on ${sha.slice(0, 7)}.`, evidence)
    }
    const failed = jobs.find((job) => job.conclusion !== 'success')
    evidence.jobConclusion = failed ? failed.conclusion : 'success'
    if (failed) {
      return this.verdict(
        false,
        'CHECKS_FAILED',
        `"${failed.name}" concluded ${failed.conclusion ?? 'without a result'} on ${sha.slice(0, 7)} (run #${run.runNumber}).`,
        evidence,
      )
    }
    return this.verdict(
      true,
      'CHECKS_PASSED',
      `"${spec.jobName}" passed on ${spec.requireMerge ? `${spec.baseBranch} after merging` : 'the head of'} PR #${pr.number} (${sha.slice(0, 7)}, run #${run.runNumber}). No protected path was changed.`,
      evidence,
    )
  }

  private emptyEvidence(task: TaskRecord, prNumber: number): CiEvidence {
    const spec = task.spec as CiFixSpec
    return {
      prUrl: `https://github.com/${spec.repo.owner}/${spec.repo.name}/pull/${prNumber}`,
      prNumber,
      author: task.claimantHandle ?? '',
      headSha: '',
      merged: false,
      mergeSha: null,
      verifiedSha: null,
      runId: null,
      runUrl: null,
      runConclusion: null,
      jobName: null,
      jobUrl: null,
      jobConclusion: null,
      filesChecked: 0,
      protectedTouched: [],
    }
  }

  private verdict(valid: boolean, code: CiFixVerification['code'], reason: string, evidence: CiEvidence): CiFixVerification {
    return { kind: TASK_KIND_CI_FIX, valid, code, reason, evidence, verifier: this.name, checkedAt: this.clock.now() }
  }
}
