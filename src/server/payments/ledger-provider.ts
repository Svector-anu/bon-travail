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
    return this.store.getPayment(taskId, kind)
  }

  async fundTask(task: TaskRecord): Promise<PaymentResult> {
    const existing = this.store.getPayment(task.id, 'fund')
    if (existing?.status === 'confirmed') return { payment: existing, settled: true }

    if (task.rewardMicro <= 0n || task.rewardMicro > this.policy.maxRewardMicro) {
      throw new PaymentPolicyError(
        `reward ${formatUsdc(task.rewardMicro)} USDC is outside the per-task cap of ${formatUsdc(this.policy.maxRewardMicro)}`,
      )
    }
    const outstanding = this.store.outstandingEscrow()
    if (outstanding + task.rewardMicro > this.policy.maxOutstandingEscrowMicro) {
      throw new PaymentPolicyError(
        `funding ${task.id} would exceed the outstanding escrow cap of ${formatUsdc(this.policy.maxOutstandingEscrowMicro)} USDC`,
      )
    }
    await this.rail.assertCanReserve(outstanding + task.rewardMicro)

    const now = this.clock.now()
    const payment = this.store.ensurePayment(this.newPayment(task, 'fund', null, now))
    return { payment: this.store.updatePayment(payment.id, { status: 'confirmed' }, now), settled: true }
  }

  async releasePayment(task: TaskRecord, recipient: Address): Promise<PaymentResult> {
    if (task.state !== 'ACCEPTED') {
      throw new PaymentPolicyError(`${task.id} is ${task.state}; only ACCEPTED tasks can be paid`)
    }
    if (!task.claimant || task.claimant !== recipient) {
      throw new PaymentPolicyError(`payout recipient ${recipient} is not the claimant of ${task.id}`)
    }
    if (this.store.getPayment(task.id, 'refund')) {
      throw new PaymentPolicyError(`${task.id} was refunded and can never be paid`)
    }

    const holder = `release:${task.id}`
    if (!this.store.acquireLease(PAYOUT_LEASE, holder, this.clock.now(), PAYOUT_LEASE_TTL_MS)) {
      throw new PaymentRailError('another payout is in flight; retry shortly')
    }
    try {
      return await this.releaseUnderLease(task, recipient)
    } finally {
      this.store.releaseLease(PAYOUT_LEASE, holder)
    }
  }

  private async releaseUnderLease(task: TaskRecord, recipient: Address): Promise<PaymentResult> {
    let payment = this.store.getPayment(task.id, 'release')

    if (!payment) {
      if (task.rewardMicro > this.policy.maxRewardMicro) {
        throw new PaymentPolicyError(`reward exceeds per-task cap of ${formatUsdc(this.policy.maxRewardMicro)} USDC`)
      }
      if (this.store.getPayment(task.id, 'fund')?.status !== 'confirmed') {
        throw new PaymentPolicyError(`${task.id} was never funded`)
      }
      const spentToday = this.store.releasedSince(this.clock.now() - DAY_MS)
      if (spentToday + task.rewardMicro > this.policy.dailyPayoutCapMicro) {
        throw new PaymentPolicyError(
          `daily payout cap of ${formatUsdc(this.policy.dailyPayoutCapMicro)} USDC reached (${formatUsdc(spentToday)} paid in the last 24h)`,
        )
      }
      payment = this.store.ensurePayment(this.newPayment(task, 'release', recipient, this.clock.now()))
    }

    if (payment.status === 'confirmed') return { payment, settled: true }
    if (payment.recipient !== recipient || payment.amountMicro !== task.rewardMicro) {
      throw new PaymentPolicyError(`stored payout for ${task.id} does not match the task; refusing to send`)
    }

    if (!payment.rawTx || !payment.txHash) {
      const signed = await this.rail.signTransfer(payment.idempotencyKey, recipient, payment.amountMicro)
      payment = this.store.updatePayment(
        payment.id,
        { status: 'pending', txHash: signed.txHash, rawTx: signed.rawTx },
        this.clock.now(),
      )
    }

    const signed = { txHash: payment.txHash!, rawTx: payment.rawTx! }
    try {
      await this.rail.broadcast(signed)
    } catch (error) {
      this.store.updatePayment(payment.id, { status: 'pending', error: errorMessage(error) }, this.clock.now())
      throw error
    }
    payment = this.store.updatePayment(payment.id, { status: 'submitted' }, this.clock.now())

    const confirmation = await this.rail.confirmation(signed.txHash)
    if (confirmation === 'confirmed') {
      return { payment: this.store.updatePayment(payment.id, { status: 'confirmed' }, this.clock.now()), settled: true }
    }
    if (confirmation === 'failed') {
      this.store.updatePayment(payment.id, { status: 'failed', error: 'payout transaction reverted' }, this.clock.now())
      throw new PaymentPolicyError(`payout transaction ${signed.txHash} reverted; needs operator review`)
    }
    return { payment, settled: false }
  }

  async refundTask(task: TaskRecord): Promise<PaymentResult> {
    if (task.state !== 'EXPIRED') {
      throw new PaymentPolicyError(`${task.id} is ${task.state}; only EXPIRED tasks can be refunded`)
    }
    if (this.store.getPayment(task.id, 'release')) {
      throw new PaymentPolicyError(`${task.id} already has a payout and can never be refunded`)
    }
    const now = this.clock.now()
    const payment = this.store.ensurePayment(this.newPayment(task, 'refund', null, now))
    if (payment.status === 'confirmed') return { payment, settled: true }
    return { payment: this.store.updatePayment(payment.id, { status: 'confirmed' }, now), settled: true }
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
