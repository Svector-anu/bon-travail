import { createHash } from 'node:crypto'
import { investigationIsCurrent, type FindingEvent, type FindingRecord, type RepoRecord, type WorkflowRunRecord } from '@/domain/findings'
import { formatUsdc } from '@/domain/money'
import { isTerminal } from '@/domain/task-state'
import {
  TASK_KIND_CI_FIX,
  type AttemptRecord,
  type PaymentRecord,
  type TaskEvent,
  type TaskRecord,
  type VerificationResult,
} from '@/domain/types'
import type {
  AttemptView,
  FindingSummaryView,
  FindingView,
  PaymentView,
  ReceiptFinding,
  ReceiptInvestigation,
  ReceiptView,
  RepoView,
  TaskView,
  TimelineEntry,
  VerificationView,
} from '@/domain/views'
import { CI_VERIFIER_NAME } from '../verification/ci-verifier'
import { TX_FACT_VERIFIER_NAME } from '../verification/tx-fact-verifier'

export interface ViewContext {
  explorerUrl: string
}

export interface ReceiptContext {
  finding: ReceiptFinding
  investigation: ReceiptInvestigation | null
}

export function displayId(task: Pick<TaskRecord, 'seq' | 'kind'>): string {
  return `${task.kind === TASK_KIND_CI_FIX ? 'WORK' : 'TASK'}-${String(task.seq).padStart(3, '0')}`
}

export function findingDisplayIdOf(finding: Pick<FindingRecord, 'seq'>): string {
  return `FIND-${String(finding.seq).padStart(3, '0')}`
}

export function explorerTx(explorerUrl: string, hash: string): string {
  return `${explorerUrl.replace(/\/$/, '')}/tx/${hash}`
}

export function toTaskView(task: TaskRecord, attemptCount: number, ctx: ViewContext): TaskView {
  const spec = task.spec
  return {
    id: task.id,
    displayId: displayId(task),
    kind: task.kind,
    title: task.title,
    description: task.description,
    reward: formatUsdc(task.rewardMicro),
    currency: task.currency,
    chain: task.chain,
    state: task.state,
    deadlineAt: task.deadlineAt,
    createdAt: task.createdAt,
    claimedAt: task.claimedAt,
    submittedAt: task.submittedAt,
    settledAt: task.settledAt,
    claimant: task.claimant,
    claimantHandle: task.claimantHandle,
    claimExpiresAt: task.claimExpiresAt,
    attemptCount,
    tx:
      spec.kind === 'tx-fact-check'
        ? {
            txHash: spec.txHash,
            explorerTxUrl: explorerTx(ctx.explorerUrl, spec.txHash),
            expected: isTerminal(task.state)
              ? { recipient: spec.expected.recipient, amount: formatUsdc(spec.expected.amountMicro) }
              : null,
          }
        : null,
    ci:
      spec.kind === TASK_KIND_CI_FIX
        ? {
            findingId: spec.findingId,
            findingDisplayId: `FIND-${spec.findingId.replace(/^find_/, '')}`,
            repo: `${spec.repo.owner}/${spec.repo.name}`,
            repoUrl: `https://github.com/${spec.repo.owner}/${spec.repo.name}`,
            baseBranch: spec.baseBranch,
            workflowName: spec.workflowName,
            workflowPath: spec.workflowPath,
            jobName: spec.jobName,
            acceptance: spec.acceptance,
            scope: spec.scope,
            protectedPaths: spec.protectedPaths,
            requireMerge: spec.requireMerge,
            contributors: spec.contributors.map((c) => c.login),
            openToAnyone: spec.openToAnyone === true,
            bonusUsdc: spec.bonusUsdc ?? null,
            bug: spec.reproTest
              ? {
                  issueNumber: spec.reproTest.issueNumber,
                  issueTitle: spec.reproTest.issueTitle,
                  issueUrl: spec.reproTest.issueUrl,
                  testPath: spec.reproTest.path,
                  testContent: spec.reproTest.content,
                  testCommand: spec.reproTest.command,
                }
              : null,
            approvedBy: spec.approvedBy,
          }
        : null,
  }
}

function toVerificationView(v: VerificationResult, reveal: boolean): VerificationView {
  if (v.kind === TASK_KIND_CI_FIX) return v
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
    handle: attempt.handle,
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
  claim_released: 'Claim released',
  submitted: 'Submitted',
  verifying: 'Verifying',
  verification_error: 'Verification retry',
  verification_pending: 'Waiting on checks',
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
  const ci = task.kind === TASK_KIND_CI_FIX
  const passed = attempts.find((a) => a.outcome === 'PASS')
  switch (task.state) {
    case 'PAID':
      return ci
        ? 'The fix passed the project\'s tests. Reward released to the contributor.'
        : 'Submission matched the chain exactly. Reward released to the worker.'
    case 'REFUNDED':
      return attempts.some((a) => a.outcome === 'FAIL')
        ? 'Expired before an accepted submission. Every submission failed verification.'
        : 'Expired before accepted submission.'
    case 'ACCEPTED':
      return passed ? 'Verified. Payout in flight.' : 'Verified.'
    case 'REJECTED':
      return ci
        ? 'The acceptance check failed. The work package reopens until the deadline.'
        : 'Latest submission failed verification. The agent will reopen the task.'
    case 'EXPIRED':
      return 'Deadline passed. The reward will be refunded.'
    case 'SUBMITTED':
    case 'VERIFYING':
      return ci ? 'Pull request submitted. Waiting for the project\'s tests to decide.' : 'Submission received. Waiting for verification.'
    case 'CLAIMED':
      return ci ? 'An approved contributor is working on it.' : 'A worker holds the claim lock.'
    case 'DRAFT':
    case 'FUNDED':
      return 'Approved. Reward is being escrowed.'
    default:
      return ci ? 'Open to the approved contributors.' : 'Open for a worker.'
  }
}

export interface ReceiptInput {
  task: TaskRecord
  attempts: AttemptRecord[]
  events: TaskEvent[]
  payments: PaymentRecord[]
  context: ReceiptContext | null
}

/** Builds the receipt document. Expected values appear only when settled. */
export function buildReceipt(input: ReceiptInput, ctx: ViewContext): Omit<ReceiptView, 'digest' | 'final'> {
  const { task, attempts, events, payments, context } = input
  const reveal = isTerminal(task.state)
  const byKind = new Map(payments.map((p) => [p.kind, p]))
  const winner = attempts.find((a) => a.outcome === 'PASS')
  return {
    version: 2,
    receiptId: task.id,
    task: toTaskView(task, attempts.length, ctx),
    outcome: task.state,
    outcomeReason: outcomeReason(task, attempts),
    worker: winner?.worker ?? null,
    workerHandle: winner?.handle ?? null,
    attempts: attempts.filter((a) => a.submittedAt !== null).map((a) => toAttemptView(a, reveal)),
    payout: toPaymentView(byKind.get('release'), ctx),
    funding: toPaymentView(byKind.get('fund'), ctx),
    refund: toPaymentView(byKind.get('refund'), ctx),
    timeline: toTimeline(events),
    verifier: task.kind === TASK_KIND_CI_FIX ? CI_VERIFIER_NAME : TX_FACT_VERIFIER_NAME,
    finding: context?.finding ?? null,
    investigation: context?.investigation ?? null,
  }
}

export function digestOf(bodyJson: string): string {
  return `sha256:${createHash('sha256').update(bodyJson).digest('hex')}`
}

export function toRepoView(repo: RepoRecord): RepoView {
  return {
    id: repo.id,
    slug: `${repo.owner}/${repo.name}`,
    url: `https://github.com/${repo.owner}/${repo.name}`,
    defaultBranch: repo.defaultBranch,
    workflowName: repo.workflowName,
    workflowPath: repo.workflowPath,
    connectedAt: repo.connectedAt,
    lastPolledAt: repo.lastPolledAt,
    active: repo.active,
  }
}

export function toFindingSummary(finding: FindingRecord, repo: Pick<RepoRecord, 'owner' | 'name'>): FindingSummaryView {
  return {
    id: finding.id,
    displayId: findingDisplayIdOf(finding),
    repo: `${repo.owner}/${repo.name}`,
    jobName: finding.jobName,
    stepName: finding.stepName,
    status: finding.status,
    failureCount: finding.failureCount,
    firstFailedAt: finding.firstFailedAt,
    lastFailedAt: finding.lastFailedAt,
    lastFailedRunUrl: finding.lastFailedRunUrl,
    recurrenceCount: finding.recurrenceCount,
    investigated: investigationIsCurrent(finding),
    investigationSummary: investigationIsCurrent(finding) ? (finding.investigation?.summary ?? null) : null,
    taskId: finding.taskId,
    isBug: finding.bug !== null,
  }
}

export function toFindingView(
  finding: FindingRecord,
  repo: RepoRecord,
  runs: WorkflowRunRecord[],
  events: FindingEvent[],
): FindingView {
  return {
    ...toFindingSummary(finding, repo),
    bug: finding.bug,
    repoUrl: `https://github.com/${repo.owner}/${repo.name}`,
    workflowName: finding.workflowName,
    workflowPath: finding.workflowPath,
    defaultBranch: repo.defaultBranch,
    stepCommand: finding.stepCommand,
    errorExcerpt: finding.errorExcerpt,
    firstFailedSha: finding.firstFailedSha,
    regression: finding.regression,
    investigation: finding.investigation,
    decidedBy: finding.decidedBy,
    decidedAt: finding.decidedAt,
    resolvedAt: finding.resolvedAt,
    resolvedSha: finding.resolvedSha,
    lastRecurrenceAt: finding.lastRecurrenceAt,
    runs: runs.map((r) => ({ runId: r.runId, runNumber: r.runNumber, sha: r.headSha, conclusion: r.conclusion, url: r.htmlUrl, at: r.runCreatedAt })),
    events: events.map((e) => ({ at: e.at, type: e.type, actor: e.actor, detail: e.detail })),
  }
}
