import type { TaskState } from './task-state'

export type Hex = `0x${string}`
export type Address = `0x${string}`

export const TASK_KIND_TX_FACT_CHECK = 'tx-fact-check'
export type TaskKind = typeof TASK_KIND_TX_FACT_CHECK

/** What the chain says a single-transfer USDC transaction did. */
export interface TransferFact {
  recipient: Address
  amountMicro: bigint
  from: Address
  blockNumber: bigint
  source: 'erc20-transfer-log' | 'native-value'
}

export interface TaskRecord {
  id: string
  seq: number
  kind: TaskKind
  title: string
  description: string
  rewardMicro: bigint
  currency: 'USDC'
  chain: string
  txHash: Hex
  /** Snapshot taken from the chain when the task was created. */
  expected: TransferFact
  deadlineAt: number
  state: TaskState
  claimant: Address | null
  claimId: string | null
  claimExpiresAt: number | null
  createdAt: number
  fundedAt: number | null
  openedAt: number | null
  claimedAt: number | null
  submittedAt: number | null
  settledAt: number | null
  version: number
}

export interface Submission {
  recipient: string
  amount: string
}

export interface FieldComparison {
  field: 'recipient' | 'amount'
  expected: string
  submitted: string
  match: boolean
  note?: string
}

export interface VerificationResult {
  valid: boolean
  /** One sentence a human can read on the receipt. */
  reason: string
  code: 'MATCH' | 'MISMATCH' | 'MALFORMED_SUBMISSION'
  expected: { recipient: string; amount: string }
  submitted: { recipient: string; amount: string }
  fields: FieldComparison[]
  verifier: string
  checkedAt: number
  chainBlock: string | null
}

export type AttemptOutcome = 'PASS' | 'FAIL' | 'LAPSED'

export interface AttemptRecord {
  id: string
  taskId: string
  claimId: string
  worker: Address
  claimedAt: number
  claimExpiresAt: number
  submittedAt: number | null
  submission: Submission | null
  verification: VerificationResult | null
  outcome: AttemptOutcome | null
}

export type TaskEventType =
  | 'created'
  | 'funded'
  | 'published'
  | 'claimed'
  | 'claim_lapsed'
  | 'submitted'
  | 'verifying'
  | 'verification_error'
  | 'accepted'
  | 'rejected'
  | 'reopened'
  | 'payment_failed'
  | 'paid'
  | 'expired'
  | 'refunded'

export interface TaskEvent {
  id: number
  taskId: string
  at: number
  type: TaskEventType
  fromState: TaskState | null
  toState: TaskState | null
  actor: string
  detail: Record<string, unknown>
}

export type PaymentKind = 'fund' | 'release' | 'refund'
export type PaymentStatus = 'pending' | 'submitted' | 'confirmed' | 'failed'

export interface PaymentRecord {
  id: string
  taskId: string
  kind: PaymentKind
  idempotencyKey: string
  provider: string
  amountMicro: bigint
  recipient: Address | null
  status: PaymentStatus
  txHash: Hex | null
  rawTx: Hex | null
  error: string | null
  createdAt: number
  updatedAt: number
}

export type AgentRunSource = 'aeon' | 'local-loop' | 'manual' | 'worker-event' | 'demo-seed'

export interface AgentRunRecord {
  id: string
  tickId: string | null
  source: AgentRunSource
  action: string
  taskId: string | null
  at: number
  result: 'ok' | 'error' | 'skipped'
  detail: string
  error: string | null
}

export interface AgentTickRecord {
  id: string
  source: AgentRunSource
  startedAt: number
  finishedAt: number | null
  status: 'running' | 'ok' | 'error'
  summary: string | null
}
