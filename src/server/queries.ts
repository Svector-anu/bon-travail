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
