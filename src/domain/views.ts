import type { FindingEventType, FindingStatus, Investigation, RegressionWindow } from './findings'
import type { TaskState } from './task-state'
import type { AgentRunSource, AttemptOutcome, CiEvidence, TaskEventType, TaskKind } from './types'

/** JSON-safe shapes sent to the browser and to Aeon. */

export interface TxTaskView {
  txHash: string
  explorerTxUrl: string
  /** Revealed only once the task is settled, so open tasks cannot be copied. */
  expected: { recipient: string; amount: string } | null
}

export interface CiTaskView {
  findingId: string
  findingDisplayId: string
  repo: string
  repoUrl: string
  baseBranch: string
  workflowName: string
  workflowPath: string
  jobName: string
  acceptance: string
  scope: string
  protectedPaths: string[]
  requireMerge: boolean
  /** Logins only. Wallets are known to the engineer and the payout ledger. */
  contributors: string[]
  approvedBy: string
}

export interface TaskView {
  id: string
  displayId: string
  kind: TaskKind
  title: string
  description: string
  reward: string
  currency: 'USDC'
  chain: string
  state: TaskState
  deadlineAt: number
  createdAt: number
  claimedAt: number | null
  submittedAt: number | null
  settledAt: number | null
  claimant: string | null
  claimantHandle: string | null
  claimExpiresAt: number | null
  attemptCount: number
  tx: TxTaskView | null
  ci: CiTaskView | null
}

export interface TxSubmissionView {
  kind: 'tx-fact-check'
  recipient: string
  amount: string
}

export interface CiSubmissionView {
  kind: 'ci-fix'
  prNumber: number
  prUrl: string
}

export type VerificationView =
  | {
      kind: 'tx-fact-check'
      valid: boolean
      reason: string
      code: string
      verifier: string
      checkedAt: number
      chainBlock: string | null
      expected: { recipient: string; amount: string } | null
      submitted: { recipient: string; amount: string }
      fields: { field: string; submitted: string; expected: string | null; match: boolean }[]
    }
  | {
      kind: 'ci-fix'
      valid: boolean
      reason: string
      code: string
      verifier: string
      checkedAt: number
      evidence: CiEvidence
    }

export interface AttemptView {
  claimId: string
  worker: string
  handle: string | null
  claimedAt: number
  submittedAt: number | null
  submitted: TxSubmissionView | CiSubmissionView | null
  outcome: AttemptOutcome | null
  verification: VerificationView | null
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

/** Facts about the original failure, frozen into a work package's receipt. */
export interface ReceiptFinding {
  id: string
  displayId: string
  repo: string
  workflowName: string
  workflowPath: string
  jobName: string
  stepName: string
  failureCount: number
  firstFailedAt: number
  firstFailedSha: string
  lastFailedRunUrl: string
  errorExcerpt: string | null
  regression: RegressionWindow | null
}

export interface ReceiptInvestigation {
  summary: string
  rootCause: string
  firstBadSha: string | null
  confidence: Investigation['confidence']
  runUrl: string | null
}

export interface ReceiptView {
  version: 2
  receiptId: string
  final: boolean
  digest: string | null
  task: TaskView
  outcome: TaskState
  outcomeReason: string
  worker: string | null
  workerHandle: string | null
  attempts: AttemptView[]
  payout: PaymentView | null
  funding: PaymentView | null
  refund: PaymentView | null
  timeline: TimelineEntry[]
  verifier: string
  finding: ReceiptFinding | null
  investigation: ReceiptInvestigation | null
}

export interface RepoView {
  id: string
  slug: string
  url: string
  defaultBranch: string
  workflowName: string
  workflowPath: string
  connectedAt: number
  lastPolledAt: number | null
  active: boolean
}

export interface FindingSummaryView {
  id: string
  displayId: string
  repo: string
  jobName: string
  stepName: string
  status: FindingStatus
  failureCount: number
  firstFailedAt: number
  lastFailedAt: number
  lastFailedRunUrl: string
  recurrenceCount: number
  /** Aeon investigated this episode (an investigation from before the last recurrence does not count). */
  investigated: boolean
  /** The first line of what Aeon found, for this episode only. */
  investigationSummary: string | null
  taskId: string | null
}

export interface FindingEventView {
  at: number
  type: FindingEventType
  actor: string
  detail: Record<string, unknown>
}

export interface FindingView extends FindingSummaryView {
  repoUrl: string
  workflowName: string
  workflowPath: string
  defaultBranch: string
  stepCommand: string | null
  errorExcerpt: string | null
  firstFailedSha: string
  regression: RegressionWindow | null
  investigation: Investigation | null
  decidedBy: string | null
  decidedAt: number | null
  resolvedAt: number | null
  resolvedSha: string | null
  lastRecurrenceAt: number | null
  runs: { runId: number; runNumber: number; sha: string; conclusion: string; url: string; at: number }[]
  events: FindingEventView[]
}

/** Live, outside the frozen receipt: whether the fixed failure has come back. */
export interface RecurrenceWatch {
  findingId: string
  findingDisplayId: string
  status: FindingStatus
  greenRunsSinceFix: number
  recurrenceCount: number
  lastRecurrenceAt: number | null
  resolvedSha: string | null
  lastPolledAt: number | null
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
  findingId?: string | null
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
