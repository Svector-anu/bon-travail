import type { TaskState } from './task-state'

export type Hex = `0x${string}`
export type Address = `0x${string}`

/** Rail test: read an Arc transaction. Proves the payment loop end to end. */
export const TASK_KIND_TX_FACT_CHECK = 'tx-fact-check'
/** Product: fix a recurring CI failure that an engineer chose to externalize. */
export const TASK_KIND_CI_FIX = 'ci-fix'
export type TaskKind = typeof TASK_KIND_TX_FACT_CHECK | typeof TASK_KIND_CI_FIX

/** What the chain says a single-transfer USDC transaction did. */
export interface TransferFact {
  recipient: Address
  amountMicro: bigint
  from: Address
  blockNumber: bigint
  source: 'erc20-transfer-log' | 'native-value'
}

export interface TxFactSpec {
  kind: typeof TASK_KIND_TX_FACT_CHECK
  txHash: Hex
  /** Snapshot taken from the chain when the task was created. */
  expected: TransferFact
}

/** A person the engineer approved, and the only wallet they can be paid at. */
export interface Contributor {
  login: string
  /** Set by the engineer, or null: then the PR author names it in the PR description. */
  wallet: Address | null
}

export interface RepoRef {
  owner: string
  name: string
}

/**
 * The test Aeon wrote to reproduce a reported bug. A fix must add this exact
 * file; the whole watched workflow, which now runs it, must pass.
 */
export interface ReproTest {
  path: string
  content: string
  sha256: string
  command: string
  issueNumber: number
  issueTitle: string
  issueUrl: string
}

/**
 * Frozen when the engineer approves. The claimant can never change the
 * acceptance condition, the protected paths or the payout wallet.
 */
export interface CiFixSpec {
  kind: typeof TASK_KIND_CI_FIX
  findingId: string
  repo: RepoRef
  baseBranch: string
  workflowPath: string
  workflowName: string
  jobName: string
  acceptance: string
  scope: string
  /** Paths a submission may not touch, so the test cannot be weakened. */
  protectedPaths: string[]
  /** When true the fix must be merged and pass on the base branch itself. */
  requireMerge: boolean
  contributors: Contributor[]
  /** Any GitHub account may claim, not just the named contributors. Absent on packages made before it existed. */
  openToAnyone?: boolean
  /** USDC the team sends itself after the fix is paid, outside escrow ("29.00"). Absent when there is none. */
  bonusUsdc?: string
  /** Present when the work is a reported bug rather than a failing CI job. */
  reproTest?: ReproTest
  approvedBy: string
}

export type TaskSpec = TxFactSpec | CiFixSpec

export interface TaskRecord {
  id: string
  seq: number
  kind: TaskKind
  title: string
  description: string
  rewardMicro: bigint
  currency: 'USDC'
  chain: string
  /** Unique per task: the tx hash for rail tests, the finding for CI work. */
  subject: string
  spec: TaskSpec
  deadlineAt: number
  state: TaskState
  /** Payout wallet of the current claim. */
  claimant: Address | null
  /** GitHub login of the current claim, for CI work. */
  claimantHandle: string | null
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

export interface TxFactSubmission {
  kind: typeof TASK_KIND_TX_FACT_CHECK
  recipient: string
  amount: string
}

export interface CiFixSubmission {
  kind: typeof TASK_KIND_CI_FIX
  prNumber: number
  prUrl: string
}

export type Submission = TxFactSubmission | CiFixSubmission

export interface FieldComparison {
  field: 'recipient' | 'amount'
  expected: string
  submitted: string
  match: boolean
  note?: string
}

interface VerificationBase {
  valid: boolean
  /** One sentence a human can read on the receipt. */
  reason: string
  verifier: string
  checkedAt: number
}

export interface TxFactVerification extends VerificationBase {
  kind: typeof TASK_KIND_TX_FACT_CHECK
  code: 'MATCH' | 'MISMATCH' | 'MALFORMED_SUBMISSION'
  expected: { recipient: string; amount: string }
  submitted: { recipient: string; amount: string }
  fields: FieldComparison[]
  chainBlock: string | null
}

/** What GitHub itself reported. Every field links back to something checkable. */
export interface CiEvidence {
  prUrl: string
  prNumber: number
  author: string
  headSha: string
  merged: boolean
  mergeSha: string | null
  /** The commit whose acceptance run decided the verdict. */
  verifiedSha: string | null
  runId: number | null
  runUrl: string | null
  runConclusion: string | null
  jobName: string | null
  jobUrl: string | null
  jobConclusion: string | null
  filesChecked: number
  protectedTouched: string[]
}

export interface CiFixVerification extends VerificationBase {
  kind: typeof TASK_KIND_CI_FIX
  code: 'CHECKS_PASSED' | 'CHECKS_FAILED' | 'PROTECTED_PATH' | 'WRONG_AUTHOR' | 'WRONG_TARGET' | 'CLOSED_UNMERGED' | 'REPRO_TEST_MISSING'
  evidence: CiEvidence
}

export type VerificationResult = TxFactVerification | CiFixVerification

export type AttemptOutcome = 'PASS' | 'FAIL' | 'LAPSED'

export interface AttemptRecord {
  id: string
  taskId: string
  claimId: string
  worker: Address
  /** GitHub login for CI work; null for rail tests. */
  handle: string | null
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
  | 'claim_released'
  | 'submitted'
  | 'verifying'
  | 'verification_error'
  | 'verification_pending'
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

export type AgentRunSource = 'aeon' | 'local-loop' | 'manual' | 'worker-event' | 'demo-seed' | 'cron' | 'owner'

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
