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

export type StatusTone = 'live' | 'busy' | 'paid' | 'refund' | ''

export const TASK_STATUS: Record<TaskState, { label: string; tone: StatusTone }> = {
  DRAFT: { label: 'Draft', tone: '' },
  FUNDED: { label: 'Funded', tone: '' },
  OPEN: { label: 'Live', tone: 'live' },
  CLAIMED: { label: 'Claimed', tone: 'busy' },
  SUBMITTED: { label: 'Verifying', tone: 'busy' },
  VERIFYING: { label: 'Verifying', tone: 'busy' },
  ACCEPTED: { label: 'Paying', tone: 'busy' },
  PAID: { label: 'Paid', tone: 'paid' },
  REJECTED: { label: 'Reopening', tone: 'busy' },
  EXPIRED: { label: 'Expired', tone: 'refund' },
  REFUNDED: { label: 'Refunded', tone: 'refund' },
}

export function displayIdFromTaskId(taskId: string): string {
  return taskId.replace(/^task_/, 'TASK-')
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
      return detail.startsWith('RPC verification passed') ? `Verification passed on ${id}` : `Answer rejected on ${id}`
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
    default:
      return detail
  }
}
