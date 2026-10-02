import type { TaskState } from './task-state'
import type { AgentRunSource, AttemptOutcome, TaskEventType, VerificationResult } from './types'

/** JSON-safe shapes sent to the browser and to Aeon. */

export interface TaskView {
  id: string
  displayId: string
  kind: string
  title: string
  description: string
  reward: string
  currency: 'USDC'
  chain: string
  txHash: string
  explorerTxUrl: string
  state: TaskState
  deadlineAt: number
  createdAt: number
  claimedAt: number | null
  submittedAt: number | null
  settledAt: number | null
  claimant: string | null
  claimExpiresAt: number | null
  attemptCount: number
  /** Revealed only once the task is settled, so open tasks cannot be copied. */
  expected: { recipient: string; amount: string } | null
}

export interface AttemptView {
  claimId: string
  worker: string
  claimedAt: number
  submittedAt: number | null
  submitted: { recipient: string; amount: string } | null
  outcome: AttemptOutcome | null
  verification: VerificationView | null
}

/** VerificationResult with expected values withheld until settlement. */
export type VerificationView = Omit<VerificationResult, 'expected' | 'fields'> & {
  expected: VerificationResult['expected'] | null
  fields: { field: string; submitted: string; expected: string | null; match: boolean }[]
}

export interface PaymentView {
  kind: 'fund' | 'release' | 'refund'
  provider: string
  simulated: boolean
  amount: string
  recipient: string | null
  status: string
  txHash: string | null
  explorerTxUrl: string | null
  at: number
}

export interface TimelineEntry {
  at: number
  type: TaskEventType
  label: string
  actor: string
  from: TaskState | null
  to: TaskState | null
}

export interface ReceiptView {
  version: 1
  receiptId: string
  final: boolean
  digest: string | null
  task: TaskView
  outcome: TaskState
  outcomeReason: string
  worker: string | null
  attempts: AttemptView[]
  payout: PaymentView | null
  funding: PaymentView | null
  refund: PaymentView | null
  timeline: TimelineEntry[]
  verifier: string
}

export interface AgentRunView {
  id: string
  at: number
  source: AgentRunSource
  action: string
  taskId: string | null
  result: 'ok' | 'error' | 'skipped'
  detail: string
  error: string | null
}

export type AgentHealth = 'running' | 'alive' | 'error' | 'stale' | 'never'

export interface AgentStatusView {
  health: AgentHealth
  lastTickAt: number | null
  lastTickSource: AgentRunSource | null
  lastTickSummary: string | null
  lastSuccessAt: number | null
  expectedIntervalMs: number
  nextExpectedAt: number | null
  ticksLast24h: number
  paymentProvider: string
  simulatedPayments: boolean
  chainReader: string
}

export interface TickActionView {
  action: string
  taskId: string | null
  result: 'ok' | 'error' | 'skipped'
  detail: string
  error: string | null
}

export interface TickReport {
  tickId: string | null
  source: AgentRunSource
  status: 'ok' | 'error' | 'skipped'
  startedAt: number
  finishedAt: number
  actions: TickActionView[]
  openTasks: string[]
  /** Lines worth sending to a human channel. Empty means stay silent. */
  notable: string[]
}
