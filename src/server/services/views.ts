import { createHash } from 'node:crypto'
import { formatUsdc } from '@/domain/money'
import { isTerminal } from '@/domain/task-state'
import type { AttemptRecord, PaymentRecord, TaskEvent, TaskRecord, VerificationResult } from '@/domain/types'
import type {
  AttemptView,
  PaymentView,
  ReceiptView,
  TaskView,
  TimelineEntry,
  VerificationView,
} from '@/domain/views'
import { TX_FACT_VERIFIER_NAME } from '../verification/tx-fact-verifier'

export interface ViewContext {
  explorerUrl: string
}

export function displayId(task: Pick<TaskRecord, 'seq'>): string {
  return `TASK-${String(task.seq).padStart(3, '0')}`
}

export function explorerTx(explorerUrl: string, hash: string): string {
  return `${explorerUrl.replace(/\/$/, '')}/tx/${hash}`
}

export function toTaskView(task: TaskRecord, attemptCount: number, ctx: ViewContext): TaskView {
  return {
    id: task.id,
    displayId: displayId(task),
    kind: task.kind,
    title: task.title,
    description: task.description,
    reward: formatUsdc(task.rewardMicro),
    currency: task.currency,
    chain: task.chain,
    txHash: task.txHash,
    explorerTxUrl: explorerTx(ctx.explorerUrl, task.txHash),
    state: task.state,
    deadlineAt: task.deadlineAt,
    createdAt: task.createdAt,
    claimedAt: task.claimedAt,
    submittedAt: task.submittedAt,
    settledAt: task.settledAt,
    claimant: task.claimant,
    claimExpiresAt: task.claimExpiresAt,
    attemptCount,
    expected: isTerminal(task.state)
      ? { recipient: task.expected.recipient, amount: formatUsdc(task.expected.amountMicro) }
      : null,
  }
}

function toVerificationView(v: VerificationResult, reveal: boolean): VerificationView {
  return {
    ...v,
    expected: reveal ? v.expected : null,
    fields: v.fields.map((f) => ({
      field: f.field,
      submitted: f.submitted,
      expected: reveal ? f.expected : null,
      match: f.match,
    })),
  }
}

export function toAttemptView(attempt: AttemptRecord, reveal: boolean): AttemptView {
  return {
    claimId: attempt.claimId,
    worker: attempt.worker,
    claimedAt: attempt.claimedAt,
    submittedAt: attempt.submittedAt,
    submitted: attempt.submission,
    outcome: attempt.outcome,
    verification: attempt.verification ? toVerificationView(attempt.verification, reveal) : null,
  }
}

function toPaymentView(payment: PaymentRecord | undefined, ctx: ViewContext): PaymentView | null {
  if (!payment) return null
  return {
    kind: payment.kind,
    provider: payment.provider,
    simulated: payment.provider === 'mock',
    amount: formatUsdc(payment.amountMicro),
    recipient: payment.recipient,
    status: payment.status,
    txHash: payment.txHash,
    explorerTxUrl: payment.txHash && payment.provider !== 'mock' ? explorerTx(ctx.explorerUrl, payment.txHash) : null,
    at: payment.updatedAt,
  }
}

const EVENT_LABELS: Record<TaskEvent['type'], string> = {
  created: 'Created',
  funded: 'Funded',
  published: 'Published',
  claimed: 'Claimed',
  claim_lapsed: 'Claim lapsed',
  submitted: 'Submitted',
  verifying: 'Verifying',
  verification_error: 'Verification retry',
  accepted: 'Verified',
  rejected: 'Rejected',
  reopened: 'Reopened',
  payment_failed: 'Payment retry',
  paid: 'Paid',
  expired: 'Expired',
  refunded: 'Refunded',
}

function toTimeline(events: TaskEvent[]): TimelineEntry[] {
  return events.map((e) => ({
    at: e.at,
    type: e.type,
    label: EVENT_LABELS[e.type],
    actor: e.actor,
    from: e.fromState,
    to: e.toState,
  }))
}

function outcomeReason(task: TaskRecord, attempts: AttemptRecord[]): string {
  const passed = attempts.find((a) => a.outcome === 'PASS')
  switch (task.state) {
    case 'PAID':
      return 'Submission matched the chain exactly. Reward released to the worker.'
    case 'REFUNDED':
      return attempts.some((a) => a.outcome === 'FAIL')
        ? 'Expired before an accepted submission. Every submission failed verification.'
        : 'Expired before accepted submission.'
    case 'ACCEPTED':
      return passed ? 'Verified. Payout in flight.' : 'Verified.'
    case 'REJECTED':
      return 'Latest submission failed verification. The agent will reopen the task.'
    case 'EXPIRED':
      return 'Deadline passed. The agent will refund the reward.'
    case 'SUBMITTED':
    case 'VERIFYING':
      return 'Submission received. Waiting for verification.'
    case 'CLAIMED':
      return 'A worker holds the claim lock.'
    default:
      return 'Open for a worker.'
  }
}

export interface ReceiptInput {
  task: TaskRecord
  attempts: AttemptRecord[]
  events: TaskEvent[]
  payments: PaymentRecord[]
}

/** Builds the receipt document. Expected values appear only when settled. */
export function buildReceipt(input: ReceiptInput, ctx: ViewContext): Omit<ReceiptView, 'digest' | 'final'> {
  const { task, attempts, events, payments } = input
  const reveal = isTerminal(task.state)
  const byKind = new Map(payments.map((p) => [p.kind, p]))
  const winner = attempts.find((a) => a.outcome === 'PASS')
  return {
    version: 1,
    receiptId: task.id,
    task: toTaskView(task, attempts.length, ctx),
    outcome: task.state,
    outcomeReason: outcomeReason(task, attempts),
    worker: winner?.worker ?? null,
    attempts: attempts.filter((a) => a.submittedAt !== null).map((a) => toAttemptView(a, reveal)),
    payout: toPaymentView(byKind.get('release'), ctx),
    funding: toPaymentView(byKind.get('fund'), ctx),
    refund: toPaymentView(byKind.get('refund'), ctx),
    timeline: toTimeline(events),
    verifier: TX_FACT_VERIFIER_NAME,
  }
}

export function digestOf(bodyJson: string): string {
  return `sha256:${createHash('sha256').update(bodyJson).digest('hex')}`
}
