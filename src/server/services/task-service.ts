import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { checkAddress, shortAddress } from '@/domain/address'
import { formatUsdc, parseUsdc } from '@/domain/money'
import type { TaskState } from '@/domain/task-state'
import {
  TASK_KIND_CI_FIX,
  TASK_KIND_TX_FACT_CHECK,
  type Address,
  type CiFixSubmission,
  type Hex,
  type TaskRecord,
} from '@/domain/types'
import type { ReceiptView } from '@/domain/views'
import type { ChainReader } from '../chain/chain-reader'
import type { Clock } from '../clock'
import { DomainError } from '../errors'
import type { PaymentProvider } from '../payments/payment-provider'
import { toJson } from '../store/codec'
import type { Store } from '../store/store'
import { VerificationPendingError, type VerifierRegistry } from '../verification/verifier'
import { buildReceipt, digestOf, type ReceiptContext, type ViewContext } from './views'

export interface TaskSettings {
  rewardMicro: bigint
  deadlineMs: number
  claimTtlMs: number
  chainLabel: string
  /** When true every rail-test claim must come from a verified person who owns the payout wallet. */
  identityRequired: boolean
}

export interface ClaimIdentity {
  userId: string
  wallets: readonly string[]
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

/** Supplies kind-specific facts (the finding, the investigation) frozen into a receipt. */
export type ReceiptContextProvider = (task: TaskRecord) => Promise<ReceiptContext | null>

/** Runs after a task reaches PAID or REFUNDED, inside nothing: failures are logged, not fatal. */
export type SettlementHook = (task: TaskRecord) => Promise<void>

/** A VERIFYING task untouched for this long is assumed to belong to a crashed run. */
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

/** How long an open (anyone-may-claim) work package stays held for one person. */
const OPEN_CLAIM_MS = 24 * 60 * 60 * 1000

const CLEAR_CLAIM = { claimant: null, claimantHandle: null, claimId: null, claimExpiresAt: null }

/**
 * Owns the task lifecycle. Every state change goes through Store.transition,
 * which enforces the legal-transition table and optimistic concurrency.
 */
export class TaskService {
  private readonly hooks: SettlementHook[] = []
  private receiptContext: ReceiptContextProvider = async () => null

  constructor(
    private readonly store: Store,
    private readonly chain: ChainReader,
    private readonly verifiers: VerifierRegistry,
    private readonly payments: PaymentProvider,
    private readonly clock: Clock,
    private readonly settings: TaskSettings,
    private readonly viewContext: ViewContext,
  ) {}

  onSettled(hook: SettlementHook): void {
    this.hooks.push(hook)
  }

  useReceiptContext(provider: ReceiptContextProvider): void {
    this.receiptContext = provider
  }

  /** Work packages (CI fixes and bugs) in the given states, newest first. */
  listWorkTasks(states: readonly TaskRecord['state'][]): Promise<TaskRecord[]> {
    return this.store.listTasks({ kinds: [TASK_KIND_CI_FIX], states, limit: 2000 })
  }

  getTask(taskId: string): Promise<TaskRecord | null> {
    return this.store.getTask(taskId)
  }

  requireTask(taskId: string): Promise<TaskRecord> {
    return this.store.requireTask(taskId)
  }

  // ---- creation ------------------------------------------------------------

  /** Rail test: reads the transaction from the chain and stores a DRAFT task for it. */
  async createTask(txHash: Hex, actor: string, overrides: { deadlineMs?: number } = {}): Promise<TaskRecord> {
    if (await this.store.hasTaskForSubject(txHash)) {
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
    const seq = await this.store.nextTaskSeq()
    const task = this.draft(seq, now, {
      kind: TASK_KIND_TX_FACT_CHECK,
      title: `Read Arc transaction ${shortAddress(txHash)}`,
      description: `Open this ${this.settings.chainLabel} transaction and report who received USDC and exactly how much.`,
      rewardMicro: this.settings.rewardMicro,
      subject: txHash,
      spec: { kind: TASK_KIND_TX_FACT_CHECK, txHash, expected: read.fact },
      deadlineAt: now + (overrides.deadlineMs ?? this.settings.deadlineMs),
    })
    await this.store.insertTask(task, actor)
    return task
  }

  /** Stores a work package the engineer approved. Funding happens next, under the spending policy. */
  async createWorkTask(
    input: Pick<TaskRecord, 'title' | 'description' | 'rewardMicro' | 'subject' | 'spec' | 'deadlineAt'>,
    actor: string,
  ): Promise<TaskRecord> {
    if (input.spec.kind !== TASK_KIND_CI_FIX) throw new Error('createWorkTask only creates ci-fix tasks')
    const now = this.clock.now()
    if (input.deadlineAt <= now) throw new DomainError('BAD_REQUEST', 'Deadline must be in the future')
    if (await this.store.hasTaskForSubject(input.subject)) {
      throw new DomainError('CONFLICT', 'This finding already has an open work package')
    }
    const task = this.draft(await this.store.nextTaskSeq(), now, { kind: TASK_KIND_CI_FIX, ...input })
    await this.store.insertTask(task, actor, { findingId: input.spec.findingId })
    return task
  }

  private draft(
    seq: number,
    now: number,
    fields: Pick<TaskRecord, 'kind' | 'title' | 'description' | 'rewardMicro' | 'subject' | 'spec' | 'deadlineAt'>,
  ): TaskRecord {
    return {
      id: `task_${String(seq).padStart(3, '0')}`,
      seq,
      currency: 'USDC',
      chain: this.settings.chainLabel,
      state: 'DRAFT',
      claimant: null,
      claimantHandle: null,
      claimId: null,
      claimExpiresAt: null,
      createdAt: now,
      fundedAt: null,
      openedAt: null,
      claimedAt: null,
      submittedAt: null,
      settledAt: null,
      version: 0,
      ...fields,
    }
  }

  async fundTask(taskId: string, actor: string): Promise<TaskRecord> {
    const task = await this.store.requireTask(taskId)
    if (task.state !== 'DRAFT') return task
    const { payment, settled } = await this.payments.fundTask(task)
    if (!settled) return task
    const now = this.clock.now()
    return this.store.transition({
      taskId,
      from: 'DRAFT',
      to: 'FUNDED',
      at: now,
      actor,
      event: 'funded',
      detail: { amount: formatUsdc(payment.amountMicro), provider: payment.provider, txHash: payment.txHash },
      patch: { fundedAt: now },
    })
  }

  async publishTask(taskId: string, actor: string): Promise<TaskRecord> {
    const task = await this.store.requireTask(taskId)
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

  // ---- rail-test worker flow -------------------------------------------------

  async claimTask(taskId: string, workerInput: string, identity: ClaimIdentity | null = null): Promise<ClaimResult> {
    const worker = checkAddress(workerInput)
    if (!worker.ok) throw new DomainError('BAD_REQUEST', `Wallet ${worker.reason}`)
    if (this.settings.identityRequired) {
      if (!identity) throw new DomainError('UNAUTHORIZED', 'Sign in to claim a task')
      if (!identity.wallets.includes(worker.address)) {
        throw new DomainError('FORBIDDEN', 'You can only claim with a wallet linked to your account')
      }
    }

    const now = this.clock.now()
    const existing = await this.store.requireTask(taskId)
    if (existing.kind !== TASK_KIND_TX_FACT_CHECK) {
      throw new DomainError('BAD_REQUEST', 'Work packages are claimed by linking a pull request')
    }
    if (existing.state === 'CLAIMED' && existing.claimExpiresAt !== null && existing.claimExpiresAt <= now) {
      await this.releaseLapsedClaim(taskId, 'system')
    }

    return this.store.transaction(async () => {
      const task = await this.store.lockTask(taskId)
      if (task.state === 'CLAIMED') {
        throw new DomainError('CONFLICT', `${taskId} is already claimed until ${new Date(task.claimExpiresAt ?? now).toISOString()}`)
      }
      requireState(task, ['OPEN'], 'claim')
      if (now >= task.deadlineAt) throw new DomainError('GONE', `${taskId} has passed its deadline`)
      if (await this.store.workerHasSubmitted(taskId, worker.address)) {
        throw new DomainError('FORBIDDEN', `${shortAddress(worker.address)} already submitted an answer for ${taskId}`)
      }
      if (identity && (await this.store.identityHasSubmitted(taskId, identity.userId))) {
        throw new DomainError('FORBIDDEN', `You already submitted an answer for ${taskId}`)
      }

      const claimToken = randomBytes(24).toString('hex')
      const claimExpiresAt = Math.min(now + this.settings.claimTtlMs, task.deadlineAt)
      const updated = await this.openClaim(task, {
        worker: worker.address,
        handle: null,
        identity: identity?.userId ?? null,
        claimTokenHash: hashToken(claimToken),
        claimExpiresAt,
        singleSubmission: true,
        actor: `worker:${worker.address}`,
        detail: {},
      })
      return { task: updated, claimId: updated.claimId!, claimToken, claimExpiresAt }
    })
  }

  async submitTask(taskId: string, input: SubmitInput): Promise<TaskRecord> {
    if (!checkAddress(input.recipient).ok || parseUsdc(input.amount) === null) {
      throw new DomainError(
        'BAD_REQUEST',
        'Recipient must be a 0x address and amount a plain USDC number like 1.25. Nothing was recorded; fix and resubmit.',
      )
    }
    const now = this.clock.now()
    return this.store.transaction(async () => {
      const claim = await this.store.getAttemptByClaim(input.claimId)
      if (!claim || claim.attempt.taskId !== taskId || !tokensMatch(input.claimToken, claim.claimTokenHash)) {
        throw new DomainError('FORBIDDEN', 'Claim not recognised for this task')
      }
      if (claim.attempt.submittedAt !== null) {
        throw new DomainError('CONFLICT', 'This claim already submitted an answer')
      }
      const task = await this.store.lockTask(taskId)
      if (task.claimId !== input.claimId) throw new DomainError('GONE', 'This claim is no longer active')
      requireState(task, ['CLAIMED'], 'submit to')
      if (task.claimExpiresAt !== null && now > task.claimExpiresAt) {
        throw new DomainError('GONE', 'Claim lock expired before submission. Claim the task again.')
      }

      await this.store.recordSubmission(
        input.claimId,
        { kind: TASK_KIND_TX_FACT_CHECK, recipient: input.recipient.trim(), amount: input.amount.trim() },
        now,
      )
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

  // ---- work-package flow ---------------------------------------------------

  /**
   * Claims a work package for an approved contributor. The caller has already
   * proven, from GitHub, that the linked PR was opened by this contributor.
   * The claim lasts until the deadline; the payout wallet is the one the
   * engineer approved, never one the claimant supplies.
   */
  async claimWork(taskId: string, contributor: { login: string; wallet: Address }, pr: CiFixSubmission): Promise<TaskRecord> {
    const now = this.clock.now()
    return this.store.transaction(async () => {
      const task = await this.store.lockTask(taskId)
      if (task.spec.kind !== TASK_KIND_CI_FIX) throw new DomainError('BAD_REQUEST', `${taskId} is not a work package`)
      if (task.state === 'CLAIMED' && task.claimantHandle?.toLowerCase() === contributor.login.toLowerCase()) return task
      if (task.state === 'CLAIMED') throw new DomainError('CONFLICT', `${taskId} is already claimed by @${task.claimantHandle}`)
      requireState(task, ['OPEN'], 'claim')
      if (now >= task.deadlineAt) throw new DomainError('GONE', `${taskId} has passed its deadline`)
      const named = task.spec.contributors.find((c) => c.login.toLowerCase() === contributor.login.toLowerCase())
      if (!named && !task.spec.openToAnyone) {
        throw new DomainError('FORBIDDEN', `@${contributor.login} is not on the approved list for ${taskId}`)
      }
      // A wallet the engineer set is the only one that wallet's login can be paid to.
      if (named?.wallet && named.wallet !== contributor.wallet) {
        throw new DomainError('FORBIDDEN', `@${contributor.login} can only be paid to the wallet the engineer approved`)
      }
      const login = named?.login ?? contributor.login
      return this.openClaim(task, {
        worker: contributor.wallet,
        handle: login,
        identity: `github:${login.toLowerCase()}`,
        claimTokenHash: hashToken(randomBytes(24).toString('hex')),
        // An open claim lasts a day, so nobody can sit on work they will not finish; a named one runs to the deadline.
        claimExpiresAt: named ? task.deadlineAt : Math.min(task.deadlineAt, now + OPEN_CLAIM_MS),
        singleSubmission: false,
        actor: `contributor:${login}`,
        detail: { prUrl: pr.prUrl },
      })
    })
  }

  /** Records the PR as the submission. Anyone may ask; the verdict only ever pays the approved claimant. */
  async submitWork(taskId: string, pr: CiFixSubmission, actor: string): Promise<TaskRecord> {
    const now = this.clock.now()
    return this.store.transaction(async () => {
      const task = await this.store.lockTask(taskId)
      if (task.spec.kind !== TASK_KIND_CI_FIX) throw new DomainError('BAD_REQUEST', `${taskId} is not a work package`)
      requireState(task, ['CLAIMED'], 'submit to')
      if (now >= task.deadlineAt) throw new DomainError('GONE', `${taskId} has passed its deadline`)
      const claim = task.claimId ? await this.store.getAttemptByClaim(task.claimId) : null
      if (!claim) throw new Error(`${taskId} is CLAIMED without an attempt`)
      await this.store.recordSubmission(claim.attempt.claimId, pr, now)
      return this.store.transition({
        taskId,
        from: 'CLAIMED',
        to: 'SUBMITTED',
        at: now,
        actor,
        event: 'submitted',
        detail: { claimId: claim.attempt.claimId, prUrl: pr.prUrl },
        patch: { submittedAt: now },
      })
    })
  }

  /** The engineer takes a claim back (contributor went quiet). The task reopens for the allowlist. */
  async releaseClaim(taskId: string, actor: string): Promise<TaskRecord> {
    return this.store.transaction(async () => {
      const task = await this.store.lockTask(taskId)
      requireState(task, ['CLAIMED'], 'release the claim on')
      if (task.claimId) await this.store.markAttemptLapsed(task.claimId)
      return this.store.transition({
        taskId,
        from: 'CLAIMED',
        to: 'OPEN',
        at: this.clock.now(),
        actor,
        event: 'claim_released',
        detail: { contributor: task.claimantHandle ?? task.claimant },
        patch: CLEAR_CLAIM,
      })
    })
  }

  private async openClaim(
    task: TaskRecord,
    claim: {
      worker: Address
      handle: string | null
      identity: string | null
      claimTokenHash: string
      claimExpiresAt: number
      singleSubmission: boolean
      actor: string
      detail: Record<string, unknown>
    },
  ): Promise<TaskRecord> {
    const now = this.clock.now()
    const claimId = `clm_${randomBytes(9).toString('hex')}`
    await this.store.insertAttempt({
      attempt: {
        id: `att_${randomBytes(9).toString('hex')}`,
        taskId: task.id,
        claimId,
        worker: claim.worker,
        handle: claim.handle,
        claimedAt: now,
        claimExpiresAt: claim.claimExpiresAt,
        submittedAt: null,
        submission: null,
        verification: null,
        outcome: null,
      },
      claimTokenHash: claim.claimTokenHash,
      identity: claim.identity,
      singleSubmission: claim.singleSubmission,
    })
    return this.store.transition({
      taskId: task.id,
      from: 'OPEN',
      to: 'CLAIMED',
      at: now,
      actor: claim.actor,
      event: 'claimed',
      detail: { claimId, claimExpiresAt: claim.claimExpiresAt, ...claim.detail },
      patch: {
        claimant: claim.worker,
        claimantHandle: claim.handle,
        claimId,
        claimExpiresAt: claim.claimExpiresAt,
        claimedAt: now,
      },
    })
  }

  // ---- verification and settlement -----------------------------------------

  /**
   * Runs the task's verifier. Returns the task in ACCEPTED or REJECTED.
   * If the verifier cannot decide yet (chain down, CI still running) the task
   * returns to SUBMITTED and the error is rethrown so the caller retries
   * later; the worker is never penalised for the verifier's wait.
   */
  async verifySubmission(taskId: string, actor: string): Promise<TaskRecord> {
    let task = await this.store.requireTask(taskId)
    const now = this.clock.now()
    if (task.state === 'VERIFYING') {
      const started = (await this.store.listEvents(taskId)).findLast((e) => e.type === 'verifying')?.at ?? 0
      if (now - started > STALE_VERIFYING_MS) {
        task = await this.store.transition({
          taskId,
          from: 'VERIFYING',
          to: 'SUBMITTED',
          at: now,
          actor,
          event: 'verification_error',
          detail: { error: 'previous verification run was interrupted' },
        })
      }
    }
    requireState(task, ['SUBMITTED'], 'verify')
    const claim = task.claimId ? await this.store.getAttemptByClaim(task.claimId) : null
    if (!claim?.attempt.submission) throw new Error(`${taskId} is SUBMITTED without a stored submission`)

    task = await this.store.transition({ taskId, from: 'SUBMITTED', to: 'VERIFYING', at: now, actor, event: 'verifying' })

    let result
    try {
      result = await this.verifiers.for(task.kind).verify(task, claim.attempt.submission)
    } catch (error) {
      const pending = error instanceof VerificationPendingError
      await this.store.transition({
        taskId,
        from: 'VERIFYING',
        to: 'SUBMITTED',
        at: this.clock.now(),
        actor,
        event: pending ? 'verification_pending' : 'verification_error',
        detail: pending ? { waitingFor: error.message } : { error: error instanceof Error ? error.message : String(error) },
      })
      throw error
    }

    const at = this.clock.now()
    return this.store.transaction(async () => {
      await this.store.recordVerdict(claim.attempt.claimId, result, result.valid ? 'PASS' : 'FAIL')
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
    const task = await this.store.requireTask(taskId)
    if (task.state === 'PAID') return task
    requireState(task, ['ACCEPTED'], 'pay')
    if (!task.claimant) throw new Error(`${taskId} is ACCEPTED without a claimant`)

    let result
    try {
      result = await this.payments.releasePayment(task, task.claimant)
    } catch (error) {
      await this.store.appendEvent(taskId, this.clock.now(), 'payment_failed', task.state, task.state, actor, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    if (!result.settled) return this.store.requireTask(taskId)

    const at = this.clock.now()
    const paid = await this.store.transaction(async () => {
      const next = await this.store.transition({
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
      await this.writeReceipt(next)
      return next
    })
    await this.runHooks(paid)
    return paid
  }

  /** Returns a rejected task to the pool, or expires it if the deadline passed. */
  async reopenTask(taskId: string, actor: string): Promise<TaskRecord> {
    const task = await this.store.requireTask(taskId)
    requireState(task, ['REJECTED'], 'reopen')
    const now = this.clock.now()
    if (now >= task.deadlineAt) {
      return this.store.transition({ taskId, from: 'REJECTED', to: 'EXPIRED', at: now, actor, event: 'expired', patch: CLEAR_CLAIM })
    }
    return this.store.transition({ taskId, from: 'REJECTED', to: 'OPEN', at: now, actor, event: 'reopened', patch: CLEAR_CLAIM })
  }

  async releaseLapsedClaim(taskId: string, actor: string): Promise<TaskRecord> {
    const task = await this.store.requireTask(taskId)
    const now = this.clock.now()
    if (task.state !== 'CLAIMED' || task.claimExpiresAt === null || task.claimExpiresAt > now) return task
    return this.store.transaction(async () => {
      if (task.claimId) await this.store.markAttemptLapsed(task.claimId)
      if (now >= task.deadlineAt) {
        return this.store.transition({ taskId, from: 'CLAIMED', to: 'EXPIRED', at: now, actor, event: 'expired', patch: CLEAR_CLAIM })
      }
      return this.store.transition({
        taskId,
        from: 'CLAIMED',
        to: 'OPEN',
        at: now,
        actor,
        event: 'claim_lapsed',
        detail: { worker: task.claimant },
        patch: CLEAR_CLAIM,
      })
    })
  }

  async expireTask(taskId: string, actor: string): Promise<TaskRecord> {
    const task = await this.store.requireTask(taskId)
    requireState(task, ['OPEN'], 'expire')
    const now = this.clock.now()
    if (now < task.deadlineAt) throw new DomainError('CONFLICT', `${taskId} has not reached its deadline`)
    return this.store.transition({ taskId, from: 'OPEN', to: 'EXPIRED', at: now, actor, event: 'expired' })
  }

  async refundTask(taskId: string, actor: string): Promise<TaskRecord> {
    const task = await this.store.requireTask(taskId)
    if (task.state === 'REFUNDED') return task
    requireState(task, ['EXPIRED'], 'refund')
    const { payment, settled } = await this.payments.refundTask(task)
    if (!settled) return task
    const at = this.clock.now()
    const refunded = await this.store.transaction(async () => {
      const next = await this.store.transition({
        taskId,
        from: 'EXPIRED',
        to: 'REFUNDED',
        at,
        actor,
        event: 'refunded',
        detail: {
          amount: formatUsdc(payment.amountMicro),
          provider: payment.provider,
          txHash: payment.txHash,
          reason: 'expired before accepted submission',
        },
        patch: { settledAt: at },
      })
      await this.writeReceipt(next)
      return next
    })
    await this.runHooks(refunded)
    return refunded
  }

  private async runHooks(task: TaskRecord): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook(task)
      } catch (error) {
        console.error(`settlement hook failed for ${task.id}`, error)
      }
    }
  }

  // ---- receipts ------------------------------------------------------------

  private async writeReceipt(task: TaskRecord): Promise<void> {
    const body = buildReceipt(await this.receiptInput(task), this.viewContext)
    const bodyJson = toJson(body)
    await this.store.insertReceipt({
      taskId: task.id,
      outcome: task.state,
      createdAt: this.clock.now(),
      bodyJson,
      digest: digestOf(bodyJson),
    })
  }

  private async receiptInput(task: TaskRecord) {
    return {
      task,
      attempts: await this.store.listAttempts(task.id),
      events: await this.store.listEvents(task.id),
      payments: await this.store.listPayments(task.id),
      context: await this.receiptContext(task),
    }
  }

  /**
   * Settled tasks return the frozen receipt exactly as written. Unsettled tasks
   * return a live view with final=false and expected values withheld.
   */
  async getReceipt(taskId: string): Promise<ReceiptView> {
    const stored = await this.store.getReceipt(taskId)
    if (stored) {
      const body = JSON.parse(stored.bodyJson) as Omit<ReceiptView, 'digest' | 'final'>
      return { ...body, final: true, digest: stored.digest }
    }
    const task = await this.store.requireTask(taskId)
    return { ...buildReceipt(await this.receiptInput(task), this.viewContext), final: false, digest: null }
  }
}
