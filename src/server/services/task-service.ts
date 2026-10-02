import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { checkAddress, shortAddress } from '@/domain/address'
import { formatUsdc, parseUsdc } from '@/domain/money'
import type { TaskState } from '@/domain/task-state'
import { TASK_KIND_TX_FACT_CHECK, type Hex, type Submission, type TaskRecord } from '@/domain/types'
import type { ReceiptView } from '@/domain/views'
import type { ChainReader } from '../chain/chain-reader'
import type { Clock } from '../clock'
import { DomainError } from '../errors'
import type { PaymentProvider } from '../payments/payment-provider'
import { toJson } from '../store/codec'
import type { Store } from '../store/store'
import type { VerifierRegistry } from '../verification/verifier'
import { buildReceipt, digestOf, type ViewContext } from './views'

export interface TaskSettings {
  rewardMicro: bigint
  deadlineMs: number
  claimTtlMs: number
  chainLabel: string
}

export interface ClaimResult {
  task: TaskRecord
  claimId: string
  claimToken: string
  claimExpiresAt: number
}

export interface SubmitInput {
  claimId: string
  claimToken: string
  recipient: string
  amount: string
}

/** A VERIFYING task older than this is assumed to belong to a crashed run. */
const STALE_VERIFYING_MS = 2 * 60 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function tokensMatch(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function requireState(task: TaskRecord, allowed: readonly TaskState[], action: string): void {
  if (!allowed.includes(task.state)) {
    throw new DomainError('CONFLICT', `Cannot ${action} ${task.id}: task is ${task.state}`)
  }
}

/**
 * Owns the task lifecycle. Every state change goes through Store.transition,
 * which enforces the legal-transition table and optimistic concurrency.
 */
export class TaskService {
  constructor(
    private readonly store: Store,
    private readonly chain: ChainReader,
    private readonly verifiers: VerifierRegistry,
    private readonly payments: PaymentProvider,
    private readonly clock: Clock,
    private readonly settings: TaskSettings,
    private readonly viewContext: ViewContext,
  ) {}

  // ---- creation ------------------------------------------------------------

  /** Reads the transaction from the chain and stores a DRAFT task for it. */
  async createTask(txHash: Hex, actor: string, overrides: { deadlineMs?: number } = {}): Promise<TaskRecord> {
    if (this.store.hasTaskForTx(txHash)) {
      throw new DomainError('CONFLICT', `A task for ${txHash} already exists`)
    }
    const read = await this.chain.readTransfer(txHash)
    if (read.kind !== 'ok') {
      throw new DomainError('BAD_REQUEST', `Transaction ${txHash} is not a usable USDC transfer (${read.kind})`)
    }
    if (read.fact.amountMicro <= 0n || read.fact.recipient === read.fact.from) {
      throw new DomainError('BAD_REQUEST', `Transaction ${txHash} is a zero or self transfer`)
    }

    const now = this.clock.now()
    const seq = this.store.nextTaskSeq()
    const task: TaskRecord = {
      id: `task_${String(seq).padStart(3, '0')}`,
      seq,
      kind: TASK_KIND_TX_FACT_CHECK,
      title: `Read Arc transaction ${shortAddress(txHash)}`,
      description: `Open this ${this.settings.chainLabel} transaction and report who received USDC and exactly how much.`,
      rewardMicro: this.settings.rewardMicro,
      currency: 'USDC',
      chain: this.settings.chainLabel,
      txHash,
      expected: read.fact,
      deadlineAt: now + (overrides.deadlineMs ?? this.settings.deadlineMs),
      state: 'DRAFT',
      claimant: null,
      claimId: null,
      claimExpiresAt: null,
      createdAt: now,
      fundedAt: null,
      openedAt: null,
      claimedAt: null,
      submittedAt: null,
      settledAt: null,
      version: 0,
    }
    this.store.insertTask(task, actor)
    return task
  }

  async fundTask(taskId: string, actor: string): Promise<TaskRecord> {
    const task = this.store.requireTask(taskId)
    if (task.state !== 'DRAFT') return task
    const { payment } = await this.payments.fundTask(task)
    const now = this.clock.now()
    return this.store.transition({
      taskId,
      from: 'DRAFT',
      to: 'FUNDED',
      at: now,
      actor,
      event: 'funded',
      detail: { amount: formatUsdc(payment.amountMicro), provider: payment.provider },
      patch: { fundedAt: now },
    })
  }

  publishTask(taskId: string, actor: string): TaskRecord {
    const task = this.store.requireTask(taskId)
    if (task.state !== 'FUNDED') return task
    const now = this.clock.now()
    return this.store.transition({
      taskId,
      from: 'FUNDED',
      to: 'OPEN',
      at: now,
      actor,
      event: 'published',
      patch: { openedAt: now },
    })
  }

  // ---- worker flow ---------------------------------------------------------

  claimTask(taskId: string, workerInput: string): ClaimResult {
    const worker = checkAddress(workerInput)
    if (!worker.ok) throw new DomainError('BAD_REQUEST', `Wallet ${worker.reason}`)

    const now = this.clock.now()
    const existing = this.store.requireTask(taskId)
    if (existing.state === 'CLAIMED' && existing.claimExpiresAt !== null && existing.claimExpiresAt <= now) {
      this.releaseLapsedClaim(taskId, 'system')
    }

    return this.store.transaction(() => {
      const task = this.store.requireTask(taskId)
      if (task.state === 'CLAIMED') {
        throw new DomainError('CONFLICT', `${taskId} is already claimed until ${new Date(task.claimExpiresAt ?? now).toISOString()}`)
      }
      requireState(task, ['OPEN'], 'claim')
      if (now >= task.deadlineAt) throw new DomainError('GONE', `${taskId} has passed its deadline`)
      if (this.store.workerHasSubmitted(taskId, worker.address)) {
        throw new DomainError('FORBIDDEN', `${shortAddress(worker.address)} already submitted an answer for ${taskId}`)
      }

      const claimId = `clm_${randomBytes(9).toString('hex')}`
      const claimToken = randomBytes(24).toString('hex')
      const claimExpiresAt = Math.min(now + this.settings.claimTtlMs, task.deadlineAt)
      this.store.insertAttempt(
        {
          id: `att_${randomBytes(9).toString('hex')}`,
          taskId,
          claimId,
          worker: worker.address,
          claimedAt: now,
          claimExpiresAt,
          submittedAt: null,
          submission: null,
          verification: null,
          outcome: null,
        },
        hashToken(claimToken),
      )
      const updated = this.store.transition({
        taskId,
        from: 'OPEN',
        to: 'CLAIMED',
        at: now,
        actor: `worker:${worker.address}`,
        event: 'claimed',
        detail: { claimId, claimExpiresAt },
        patch: { claimant: worker.address, claimId, claimExpiresAt, claimedAt: now },
      })
      return { task: updated, claimId, claimToken, claimExpiresAt }
    })
  }

  submitTask(taskId: string, input: SubmitInput): TaskRecord {
    if (!checkAddress(input.recipient).ok || parseUsdc(input.amount) === null) {
      throw new DomainError(
        'BAD_REQUEST',
        'Recipient must be a 0x address and amount a plain USDC number like 1.25. Nothing was recorded; fix and resubmit.',
      )
    }
    const now = this.clock.now()
    return this.store.transaction(() => {
      const claim = this.store.getAttemptByClaim(input.claimId)
      if (!claim || claim.attempt.taskId !== taskId || !tokensMatch(input.claimToken, claim.claimTokenHash)) {
        throw new DomainError('FORBIDDEN', 'Claim not recognised for this task')
      }
      if (claim.attempt.submittedAt !== null) {
        throw new DomainError('CONFLICT', 'This claim already submitted an answer')
      }
      const task = this.store.requireTask(taskId)
      if (task.claimId !== input.claimId) throw new DomainError('GONE', 'This claim is no longer active')
      requireState(task, ['CLAIMED'], 'submit to')
      if (task.claimExpiresAt !== null && now > task.claimExpiresAt) {
        throw new DomainError('GONE', 'Claim lock expired before submission. Claim the task again.')
      }

      const submission: Submission = { recipient: input.recipient.trim(), amount: input.amount.trim() }
      this.store.recordSubmission(input.claimId, submission, now)
      return this.store.transition({
        taskId,
        from: 'CLAIMED',
        to: 'SUBMITTED',
        at: now,
        actor: `worker:${claim.attempt.worker}`,
        event: 'submitted',
        detail: { claimId: input.claimId },
        patch: { submittedAt: now },
      })
    })
  }

  // ---- verification and settlement -----------------------------------------

  /**
   * Runs the deterministic verifier. Returns the task in ACCEPTED or REJECTED.
   * If the chain cannot be read the task returns to SUBMITTED and the error is
   * rethrown so the caller can retry later; the worker is not penalised.
   */
  async verifySubmission(taskId: string, actor: string): Promise<TaskRecord> {
    let task = this.store.requireTask(taskId)
    const now = this.clock.now()
    if (task.state === 'VERIFYING' && now - (task.submittedAt ?? 0) > STALE_VERIFYING_MS) {
      task = this.store.transition({
        taskId,
        from: 'VERIFYING',
        to: 'SUBMITTED',
        at: now,
        actor,
        event: 'verification_error',
        detail: { error: 'previous verification run was interrupted' },
      })
    }
    requireState(task, ['SUBMITTED'], 'verify')
    const claim = task.claimId ? this.store.getAttemptByClaim(task.claimId) : null
    if (!claim?.attempt.submission) throw new Error(`${taskId} is SUBMITTED without a stored submission`)

    task = this.store.transition({ taskId, from: 'SUBMITTED', to: 'VERIFYING', at: now, actor, event: 'verifying' })

    let result
    try {
      result = await this.verifiers.for(task.kind).verify(task, claim.attempt.submission)
    } catch (error) {
      this.store.transition({
        taskId,
        from: 'VERIFYING',
        to: 'SUBMITTED',
        at: this.clock.now(),
        actor,
        event: 'verification_error',
        detail: { error: error instanceof Error ? error.message : String(error) },
      })
      throw error
    }

    const at = this.clock.now()
    return this.store.transaction(() => {
      this.store.recordVerdict(claim.attempt.claimId, result, result.valid ? 'PASS' : 'FAIL')
      return this.store.transition({
        taskId,
        from: 'VERIFYING',
        to: result.valid ? 'ACCEPTED' : 'REJECTED',
        at,
        actor,
        event: result.valid ? 'accepted' : 'rejected',
        detail: { code: result.code, reason: result.reason, worker: claim.attempt.worker },
      })
    })
  }

  /** Pays the claimant of an ACCEPTED task. Idempotent; safe to call repeatedly. */
  async releasePayment(taskId: string, actor: string): Promise<TaskRecord> {
    const task = this.store.requireTask(taskId)
    if (task.state === 'PAID') return task
    requireState(task, ['ACCEPTED'], 'pay')
    if (!task.claimant) throw new Error(`${taskId} is ACCEPTED without a claimant`)

    let result
    try {
      result = await this.payments.releasePayment(task, task.claimant)
    } catch (error) {
      this.store.appendEvent(taskId, this.clock.now(), 'payment_failed', task.state, task.state, actor, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    if (!result.settled) return this.store.requireTask(taskId)

    const at = this.clock.now()
    return this.store.transaction(() => {
      const paid = this.store.transition({
        taskId,
        from: 'ACCEPTED',
        to: 'PAID',
        at,
        actor,
        event: 'paid',
        detail: {
          amount: formatUsdc(result.payment.amountMicro),
          recipient: result.payment.recipient,
          txHash: result.payment.txHash,
          provider: result.payment.provider,
        },
        patch: { settledAt: at },
      })
      this.writeReceipt(paid)
      return paid
    })
  }

  /** Returns a rejected task to the pool, or expires it if the deadline passed. */
  reopenTask(taskId: string, actor: string): TaskRecord {
    const task = this.store.requireTask(taskId)
    requireState(task, ['REJECTED'], 'reopen')
    const now = this.clock.now()
    const clearClaim = { claimant: null, claimId: null, claimExpiresAt: null }
    if (now >= task.deadlineAt) {
      return this.store.transition({ taskId, from: 'REJECTED', to: 'EXPIRED', at: now, actor, event: 'expired', patch: clearClaim })
    }
    return this.store.transition({ taskId, from: 'REJECTED', to: 'OPEN', at: now, actor, event: 'reopened', patch: clearClaim })
  }

  releaseLapsedClaim(taskId: string, actor: string): TaskRecord {
    const task = this.store.requireTask(taskId)
    const now = this.clock.now()
    if (task.state !== 'CLAIMED' || task.claimExpiresAt === null || task.claimExpiresAt > now) return task
    return this.store.transaction(() => {
      if (task.claimId) this.store.markAttemptLapsed(task.claimId)
      const clearClaim = { claimant: null, claimId: null, claimExpiresAt: null }
      if (now >= task.deadlineAt) {
        return this.store.transition({ taskId, from: 'CLAIMED', to: 'EXPIRED', at: now, actor, event: 'expired', patch: clearClaim })
      }
      return this.store.transition({
        taskId,
        from: 'CLAIMED',
        to: 'OPEN',
        at: now,
        actor,
        event: 'claim_lapsed',
        detail: { worker: task.claimant },
        patch: clearClaim,
      })
    })
  }

  expireTask(taskId: string, actor: string): TaskRecord {
    const task = this.store.requireTask(taskId)
    requireState(task, ['OPEN'], 'expire')
    const now = this.clock.now()
    if (now < task.deadlineAt) throw new DomainError('CONFLICT', `${taskId} has not reached its deadline`)
    return this.store.transition({ taskId, from: 'OPEN', to: 'EXPIRED', at: now, actor, event: 'expired' })
  }

  async refundTask(taskId: string, actor: string): Promise<TaskRecord> {
    const task = this.store.requireTask(taskId)
    if (task.state === 'REFUNDED') return task
    requireState(task, ['EXPIRED'], 'refund')
    const { payment } = await this.payments.refundTask(task)
    const at = this.clock.now()
    return this.store.transaction(() => {
      const refunded = this.store.transition({
        taskId,
        from: 'EXPIRED',
        to: 'REFUNDED',
        at,
        actor,
        event: 'refunded',
        detail: { amount: formatUsdc(payment.amountMicro), provider: payment.provider, reason: 'expired before accepted submission' },
        patch: { settledAt: at },
      })
      this.writeReceipt(refunded)
      return refunded
    })
  }

  // ---- receipts ------------------------------------------------------------

  private writeReceipt(task: TaskRecord): void {
    const body = buildReceipt(this.receiptInput(task), this.viewContext)
    const bodyJson = toJson(body)
    this.store.insertReceipt({ taskId: task.id, outcome: task.state, createdAt: this.clock.now(), bodyJson, digest: digestOf(bodyJson) })
  }

  private receiptInput(task: TaskRecord) {
    return {
      task,
      attempts: this.store.listAttempts(task.id),
      events: this.store.listEvents(task.id),
      payments: this.store.listPayments(task.id),
    }
  }

  /**
   * Settled tasks return the frozen receipt exactly as written. Unsettled tasks
   * return a live view with final=false and expected values withheld.
   */
  getReceipt(taskId: string): ReceiptView {
    const stored = this.store.getReceipt(taskId)
    if (stored) {
      const body = JSON.parse(stored.bodyJson) as Omit<ReceiptView, 'digest' | 'final'>
      return { ...body, final: true, digest: stored.digest }
    }
    const task = this.store.requireTask(taskId)
    return { ...buildReceipt(this.receiptInput(task), this.viewContext), final: false, digest: null }
  }
}
