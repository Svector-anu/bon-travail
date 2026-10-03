import { formatUsdc } from '@/domain/money'
import type { Address, PaymentKind, PaymentRecord, TaskRecord } from '@/domain/types'
import type { Clock } from '../clock'
import type { Store } from '../store/store'
import {
  PaymentPolicyError,
  PaymentRailError,
  type PaymentProvider,
  type PaymentRail,
  type PaymentResult,
  type RailCall,
} from './payment-provider'

export interface SpendingPolicy {
  maxRewardMicro: bigint
  dailyPayoutCapMicro: bigint
  maxOutstandingEscrowMicro: bigint
}

const DAY_MS = 24 * 60 * 60 * 1000
const PAYOUT_LEASE = 'payments'
const PAYOUT_LEASE_TTL_MS = 60_000

function idempotencyKey(taskId: string, kind: PaymentKind): string {
  return `${kind}:${taskId}`
}

/**
 * Wraps a rail with the ledger and the spending policy. The ledger row for a
 * (task, kind) is written before any external call, so every retry resumes the
 * same payment. Policy checks run only when a new row would be created, so a
 * retry can never be double-counted against the caps.
 */
export class LedgerPaymentProvider implements PaymentProvider {
  readonly name: string
  readonly simulated: boolean

  constructor(
    private readonly store: Store,
    private readonly rail: PaymentRail,
    private readonly policy: SpendingPolicy,
    private readonly clock: Clock,
  ) {
    this.name = rail.name
    this.simulated = rail.simulated
  }

  async getPaymentStatus(taskId: string, kind: PaymentKind): Promise<PaymentRecord | null> {
    return await this.store.getPayment(taskId, kind)
  }

  async fundTask(task: TaskRecord): Promise<PaymentResult> {
    const existing = await this.store.getPayment(task.id, 'fund')
    if (existing?.status === 'confirmed') return { payment: existing, settled: true }

    if (task.rewardMicro <= 0n || task.rewardMicro > this.policy.maxRewardMicro) {
      throw new PaymentPolicyError(
        `reward ${formatUsdc(task.rewardMicro)} USDC is outside the per-task cap of ${formatUsdc(this.policy.maxRewardMicro)}`,
      )
    }
    const outstanding = await this.store.outstandingEscrow()
    if (outstanding + task.rewardMicro > this.policy.maxOutstandingEscrowMicro) {
      throw new PaymentPolicyError(
        `funding ${task.id} would exceed the outstanding escrow cap of ${formatUsdc(this.policy.maxOutstandingEscrowMicro)} USDC`,
      )
    }
    if (!existing) await this.rail.assertCanReserve({ newMicro: task.rewardMicro, outstandingMicro: outstanding })

    const now = this.clock.now()
    const payment = await this.store.ensurePayment(this.newPayment(task, 'fund', null, now))
    if (!this.rail.onchainEscrow) {
      return { payment: await this.store.updatePayment(payment.id, { status: 'confirmed' }, now), settled: true }
    }
    return this.withLease(`fund:${task.id}`, () => this.settle(payment, this.callFor(task, payment)))
  }

  async releasePayment(task: TaskRecord, recipient: Address): Promise<PaymentResult> {
    if (task.state !== 'ACCEPTED') {
      throw new PaymentPolicyError(`${task.id} is ${task.state}; only ACCEPTED tasks can be paid`)
    }
    if (!task.claimant || task.claimant !== recipient) {
      throw new PaymentPolicyError(`payout recipient ${recipient} is not the claimant of ${task.id}`)
    }
    if (await this.store.getPayment(task.id, 'refund')) {
      throw new PaymentPolicyError(`${task.id} was refunded and can never be paid`)
    }

    return this.withLease(`release:${task.id}`, () => this.releaseUnderLease(task, recipient))
  }

  private async releaseUnderLease(task: TaskRecord, recipient: Address): Promise<PaymentResult> {
    let payment = await this.store.getPayment(task.id, 'release')

    if (!payment) {
      if (task.rewardMicro > this.policy.maxRewardMicro) {
        throw new PaymentPolicyError(`reward exceeds per-task cap of ${formatUsdc(this.policy.maxRewardMicro)} USDC`)
      }
      if ((await this.store.getPayment(task.id, 'fund'))?.status !== 'confirmed') {
        throw new PaymentPolicyError(`${task.id} was never funded`)
      }
      const spentToday = await this.store.releasedSince(this.clock.now() - DAY_MS)
      if (spentToday + task.rewardMicro > this.policy.dailyPayoutCapMicro) {
        throw new PaymentPolicyError(
          `daily payout cap of ${formatUsdc(this.policy.dailyPayoutCapMicro)} USDC reached (${formatUsdc(spentToday)} paid in the last 24h)`,
        )
      }
      payment = await this.store.ensurePayment(this.newPayment(task, 'release', recipient, this.clock.now()))
    }

    if (payment.status === 'confirmed') return { payment, settled: true }
    if (payment.recipient !== recipient || payment.amountMicro !== task.rewardMicro) {
      throw new PaymentPolicyError(`stored payout for ${task.id} does not match the task; refusing to send`)
    }

    return this.settle(payment, this.callFor(task, payment))
  }

  async refundTask(task: TaskRecord): Promise<PaymentResult> {
    if (task.state !== 'EXPIRED') {
      throw new PaymentPolicyError(`${task.id} is ${task.state}; only EXPIRED tasks can be refunded`)
    }
    if (await this.store.getPayment(task.id, 'release')) {
      throw new PaymentPolicyError(`${task.id} already has a payout and can never be refunded`)
    }
    const now = this.clock.now()
    const payment = await this.store.ensurePayment(this.newPayment(task, 'refund', null, now))
    if (payment.status === 'confirmed') return { payment, settled: true }
    if (!this.rail.onchainEscrow) {
      return { payment: await this.store.updatePayment(payment.id, { status: 'confirmed' }, now), settled: true }
    }
    return this.withLease(`refund:${task.id}`, () => this.settle(payment, this.callFor(task, payment)))
  }

  /** Serialises every transaction the payer signs, so nonces never collide. */
  private async withLease<T>(holder: string, fn: () => Promise<T>): Promise<T> {
    if (!(await this.store.acquireLease(PAYOUT_LEASE, holder, this.clock.now(), PAYOUT_LEASE_TTL_MS))) {
      throw new PaymentRailError('another payment is in flight; retry shortly')
    }
    try {
      return await fn()
    } finally {
      await this.store.releaseLease(PAYOUT_LEASE, holder)
    }
  }

  private callFor(task: TaskRecord, payment: PaymentRecord): RailCall {
    return {
      kind: payment.kind,
      taskId: task.id,
      idempotencyKey: payment.idempotencyKey,
      amountMicro: payment.amountMicro,
      to: payment.recipient,
      deadlineMs: task.deadlineAt,
    }
  }

  /**
   * Sign once, store, then broadcast and confirm. A retry finds the stored
   * transaction and rebroadcasts it, so the same money can never move twice.
   */
  private async settle(initial: PaymentRecord, call: RailCall): Promise<PaymentResult> {
    let payment = initial
    if (payment.status === 'confirmed') return { payment, settled: true }

    if (!payment.rawTx || !payment.txHash) {
      await this.rail.beforeSign?.(call)
      const signed = await this.rail.sign(call)
      payment = await this.store.updatePayment(
        payment.id,
        { status: 'pending', txHash: signed.txHash, rawTx: signed.rawTx },
        this.clock.now(),
      )
    }

    const signed = { txHash: payment.txHash!, rawTx: payment.rawTx! }
    try {
      await this.rail.broadcast(signed)
    } catch (error) {
      await this.store.updatePayment(payment.id, { status: 'pending', error: errorMessage(error) }, this.clock.now())
      throw error
    }
    payment = await this.store.updatePayment(payment.id, { status: 'submitted' }, this.clock.now())

    const confirmation = await this.rail.confirmation(signed.txHash)
    if (confirmation === 'confirmed') {
      return { payment: await this.store.updatePayment(payment.id, { status: 'confirmed' }, this.clock.now()), settled: true }
    }
    if (confirmation === 'failed') {
      await this.store.updatePayment(payment.id, { status: 'failed', error: `${call.kind} transaction reverted` }, this.clock.now())
      throw new PaymentPolicyError(`${call.kind} transaction ${signed.txHash} reverted; needs operator review`)
    }
    return { payment, settled: false }
  }

  private newPayment(task: TaskRecord, kind: PaymentKind, recipient: Address | null, now: number): PaymentRecord {
    return {
      id: `pay_${kind}_${task.id}`,
      taskId: task.id,
      kind,
      idempotencyKey: idempotencyKey(task.id, kind),
      provider: this.rail.name,
      amountMicro: task.rewardMicro,
      recipient,
      status: 'pending',
      txHash: null,
      rawTx: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    }
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
