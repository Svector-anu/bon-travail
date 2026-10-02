import type { Address, Hex, PaymentKind, PaymentRecord, TaskRecord } from '@/domain/types'

export interface PaymentResult {
  payment: PaymentRecord
  /** True once the money movement is final (confirmed on chain or in the ledger). */
  settled: boolean
}

/**
 * Task logic talks only to this interface. Every operation is keyed by task id
 * and is idempotent: calling it again returns the original payment instead of
 * moving money twice.
 */
export interface PaymentProvider {
  readonly name: string
  /** True when no real funds move. The UI labels these payouts SIMULATED. */
  readonly simulated: boolean
  fundTask(task: TaskRecord): Promise<PaymentResult>
  releasePayment(task: TaskRecord, recipient: Address): Promise<PaymentResult>
  refundTask(task: TaskRecord): Promise<PaymentResult>
  getPaymentStatus(taskId: string, kind: PaymentKind): Promise<PaymentRecord | null>
}

/** A spending rule was violated. Never retried automatically. */
export class PaymentPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentPolicyError'
  }
}

/** The rail failed in a way that is safe to retry with the same idempotency key. */
export class PaymentRailError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PaymentRailError'
  }
}

/** Payment configuration is missing or invalid. The system refuses to move money. */
export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentConfigError'
  }
}

export interface SignedTransfer {
  txHash: Hex
  rawTx: Hex
}

/** Everything a rail needs to build one money movement for one task. */
export interface RailCall {
  kind: PaymentKind
  taskId: string
  idempotencyKey: string
  amountMicro: bigint
  /** Worker for a release; null for fund and refund. */
  to: Address | null
  deadlineMs: number
}

/**
 * The part of a payment that touches the outside world. Transactions are
 * signed first and stored, then broadcast, so a retry rebroadcasts the exact
 * same transaction (same nonce) instead of creating a second one.
 */
export interface PaymentRail {
  readonly name: string
  readonly simulated: boolean
  /** True when fund and refund are real escrow transactions rather than ledger reservations. */
  readonly onchainEscrow: boolean
  /** Throws PaymentRailError when the payer cannot cover a new reservation. */
  assertCanReserve(amounts: { newMicro: bigint; outstandingMicro: bigint }): Promise<void>
  /** Last checks before signing (token approval, chain time). Throw PaymentRailError to retry later. */
  beforeSign?(call: RailCall): Promise<void>
  sign(call: RailCall): Promise<SignedTransfer>
  broadcast(signed: SignedTransfer): Promise<void>
  confirmation(txHash: Hex): Promise<'confirmed' | 'pending' | 'failed'>
}
