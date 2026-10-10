import type { FindingStatus } from '@/domain/findings'
import type { TaskState } from '@/domain/task-state'

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

export function formatAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

export type StatusTone = 'live' | 'busy' | 'claimed' | 'paid' | 'refund' | ''

export const TASK_STATUS: Record<TaskState, { label: string; tone: StatusTone }> = {
  DRAFT: { label: 'Draft', tone: '' },
  FUNDED: { label: 'Funded', tone: '' },
  OPEN: { label: 'Live', tone: 'live' },
  CLAIMED: { label: 'Claimed', tone: 'claimed' },
  SUBMITTED: { label: 'Verifying', tone: 'busy' },
  VERIFYING: { label: 'Verifying', tone: 'busy' },
  ACCEPTED: { label: 'Paying', tone: 'busy' },
  PAID: { label: 'Paid', tone: 'paid' },
  REJECTED: { label: 'Reopening', tone: 'busy' },
  EXPIRED: { label: 'Expired', tone: 'refund' },
  REFUNDED: { label: 'Refunded', tone: 'refund' },
}

export const FINDING_STATUS: Record<FindingStatus, { label: string; tone: StatusTone }> = {
  watching: { label: 'Watching', tone: '' },
  candidate: { label: 'Needs a decision', tone: 'claimed' },
  investigated: { label: 'Investigated', tone: 'live' },
  internal: { label: 'Kept internal', tone: 'busy' },
  externalized: { label: 'Externalized', tone: 'busy' },
  resolved: { label: 'Resolved', tone: 'paid' },
  recurred: { label: 'Came back', tone: 'refund' },
  dismissed: { label: 'Dismissed', tone: '' },
}

/** Work packages and rail tests share one sequence; the prefix says which. */
export function displayIdFromTaskId(taskId: string, kind?: string): string {
  return taskId.replace(/^task_/, kind === 'tx-fact-check' ? 'TASK-' : 'WORK-')
}

export function findingDisplayId(findingId: string): string {
  return findingId.replace(/^find_/, 'FIND-')
}

/** One plain-language line per agent action, in the agent's voice. */
export function activityHeadline(action: string, taskId: string | null, detail: string, result: string): string {
  const id = taskId ? displayIdFromTaskId(taskId) : ''
  if (result === 'error') return `${action.replace(/_/g, ' ')} failed${id ? ` on ${id}` : ''}`
  switch (action) {
    case 'create_task':
      return `Created ${id}`
    case 'fund':
      return `Reserved reward for ${id}`
    case 'publish':
      return `Published ${id}`
    case 'verify':
      if (result === 'skipped') return detail.startsWith('Waiting') ? `Waiting on checks for ${id}` : `Verification deferred on ${id}`
      return /passed:/.test(detail) ? `Fix verified on ${id}` : `Submission rejected on ${id}`
    case 'pay':
      return result === 'ok' ? detail.replace(/ to 0x\S+/, '') + ` on ${id}` : `Payout pending on ${id}`
    case 'reopen':
      return `Reopened ${id}`
    case 'expire':
      return `${id} expired`
    case 'refund':
      return `Refunded ${id}`
    case 'release_lapsed_claim':
      return `Claim lapsed on ${id}`
    case 'source_task':
      return 'Looked for a new transaction'
    case 'detect':
    case 'repeat':
    case 'resolve':
    case 'recur':
    case 'observe':
      return detail
    default:
      return detail
  }
}

/** Who may take a work package, in words: "anyone on GitHub", or the named logins. */
/** A work package's title for people: the repository and the job that fails, not the workflow path. Two packages from one repo still read apart. */
export function workTitle(ci: { repo: string; jobName: string; bug?: { issueNumber: number; issueTitle: string } | null }): string {
  const repoName = ci.repo.split('/').pop()
  if (ci.bug) return `Fix bug #${ci.bug.issueNumber} in ${repoName}: ${ci.bug.issueTitle}`
  return `Fix what's breaking ${repoName}: ${ci.jobName}`
}

export function whoMayTake(ci: { contributors: string[]; openToAnyone: boolean }): string {
  if (ci.openToAnyone) return 'anyone on GitHub'
  return ci.contributors.map((c) => `@${c}`).join(', ')
}
