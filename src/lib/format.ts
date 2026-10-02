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
  const diff = now - ts
  if (diff < 45_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`
  return `${Math.round(diff / 86_400_000)} d ago`
}

interface StateStyle {
  label: string
  tone: 'live' | 'paid' | 'fail' | 'muted'
}

export const STATE_STYLE: Record<TaskState, StateStyle> = {
  DRAFT: { label: 'Draft', tone: 'muted' },
  FUNDED: { label: 'Funded', tone: 'muted' },
  OPEN: { label: 'Open', tone: 'live' },
  CLAIMED: { label: 'Claimed', tone: 'live' },
  SUBMITTED: { label: 'Submitted', tone: 'live' },
  VERIFYING: { label: 'Verifying', tone: 'live' },
  ACCEPTED: { label: 'Paying', tone: 'live' },
  PAID: { label: 'Paid', tone: 'paid' },
  REJECTED: { label: 'Rejected', tone: 'fail' },
  EXPIRED: { label: 'Expired', tone: 'muted' },
  REFUNDED: { label: 'Refunded', tone: 'muted' },
}

const ACTION_LINES: Record<string, string> = {
  create_task: 'Agent created',
  fund: 'Reward reserved for',
  publish: 'Published',
  release_lapsed_claim: 'Claim lapsed on',
  verify: 'Verified',
  pay: 'Paid out',
  reopen: 'Reopened',
  expire: 'Expired',
  refund: 'Refunded',
  source_task: 'Looked for a new transaction',
  sweep: 'Sweep',
  tick: 'Tick',
}

export function actionLabel(action: string): string {
  return ACTION_LINES[action] ?? action
}

export function displayIdFromTaskId(taskId: string): string {
  return taskId.replace(/^task_/, 'TASK-')
}
