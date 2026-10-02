import { checkAddress } from '@/domain/address'
import { formatUsdc } from '@/domain/money'
import { isTerminal } from '@/domain/task-state'
import type { AgentRunView, AgentStatusView, AttemptView, ReceiptView, TaskView } from '@/domain/views'
import { getApp } from './container'
import { toAttemptView, toTaskView } from './services/views'

export interface TaskDetail {
  task: TaskView
  attempts: AttemptView[]
}

export interface ReceiptSummary {
  taskId: string
  displayId: string
  title: string
  outcome: string
  reward: string
  worker: string | null
  settledAt: number
  postedAt: number
  deadlineAt: number
  simulated: boolean
}

export interface ActivitySnapshot {
  status: AgentStatusView
  runs: AgentRunView[]
}

function viewContext() {
  return { explorerUrl: getApp().chain.explorerUrl }
}

export function listTaskViews(limit = 50): TaskView[] {
  const { store } = getApp()
  return store.listTasks({ limit }).map((t) => toTaskView(t, store.listAttempts(t.id).length, viewContext()))
}

export function getTaskDetail(taskId: string): TaskDetail | null {
  const { store } = getApp()
  const task = store.getTask(taskId)
  if (!task) return null
  const attempts = store.listAttempts(task.id)
  return {
    task: toTaskView(task, attempts.length, viewContext()),
    attempts: attempts.filter((a) => a.submittedAt !== null).map((a) => toAttemptView(a, isTerminal(task.state))),
  }
}

export function getReceiptView(taskId: string): ReceiptView | null {
  const { store, tasks } = getApp()
  return store.getTask(taskId) ? tasks.getReceipt(taskId) : null
}

export function recentReceipts(limit = 6): ReceiptSummary[] {
  return getApp()
    .store.listReceipts(limit)
    .map((r) => {
      const body = JSON.parse(r.bodyJson) as Omit<ReceiptView, 'digest' | 'final'>
      return {
        taskId: r.taskId,
        displayId: body.task.displayId,
        title: body.task.title,
        outcome: r.outcome,
        reward: body.task.reward,
        worker: body.worker,
        settledAt: r.createdAt,
        postedAt: body.task.createdAt,
        deadlineAt: body.task.deadlineAt,
        simulated: body.payout?.simulated ?? body.funding?.simulated ?? false,
      }
    })
}

export function agentActivity(limit = 40, taskId?: string): ActivitySnapshot {
  const { agent, store } = getApp()
  return { status: agent.status(), runs: store.listRuns(limit, taskId) }
}

const LIVE_STATES = ['OPEN', 'CLAIMED', 'SUBMITTED', 'VERIFYING', 'ACCEPTED', 'REJECTED'] as const

export interface HomeSnapshot {
  live: TaskView[]
  paidTotal: string
  paidCount: number
  refundedCount: number
  simulatedPayments: boolean
}

export function homeSnapshot(): HomeSnapshot {
  const { store, payments } = getApp()
  const totals = store.settlementTotals()
  return {
    live: store
      .listTasks({ states: LIVE_STATES, limit: 10 })
      .map((t) => toTaskView(t, store.listAttempts(t.id).length, viewContext())),
    paidTotal: formatUsdc(totals.paidMicro),
    paidCount: totals.paidCount,
    refundedCount: totals.refundedCount,
    simulatedPayments: payments.simulated,
  }
}

export interface WorkerSummary {
  address: string
  earned: string | null
  paidCount: number
  answered: number
  rejected: number
  activeClaim: { taskId: string; displayId: string; expiresAt: number } | null
  history: { taskId: string; displayId: string; outcome: string; at: number }[]
}

/** Everything one wallet has done, read straight from attempts and the payout ledger. */
export function workerSummary(addressInput: string): WorkerSummary | null {
  const check = checkAddress(addressInput)
  if (!check.ok) return null
  const { store } = getApp()
  const attempts = store.listAttemptsByWorker(check.address)
  const payouts = store.confirmedPayoutsTo(check.address)
  const earnedMicro = payouts.reduce((sum, p) => sum + p.amountMicro, 0n)
  const active = attempts
    .map((a) => ({ attempt: a, task: store.getTask(a.taskId) }))
    .find(({ attempt, task }) => task?.state === 'CLAIMED' && task.claimId === attempt.claimId)
  const displayId = (taskId: string) => taskId.replace(/^task_/, 'TASK-')
  return {
    address: check.address,
    earned: earnedMicro > 0n ? formatUsdc(earnedMicro) : null,
    paidCount: payouts.length,
    answered: attempts.filter((a) => a.submittedAt !== null).length,
    rejected: attempts.filter((a) => a.outcome === 'FAIL').length,
    activeClaim: active
      ? { taskId: active.attempt.taskId, displayId: displayId(active.attempt.taskId), expiresAt: active.attempt.claimExpiresAt }
      : null,
    history: attempts
      .filter((a) => a.outcome !== null)
      .map((a) => ({ taskId: a.taskId, displayId: displayId(a.taskId), outcome: a.outcome!, at: a.submittedAt ?? a.claimedAt })),
  }
}
