import { keccak256, toHex } from 'viem'
import type { Address, Hex } from '@/domain/types'
import type { PaymentRail, SignedTransfer } from './payment-provider'

/**
 * Deterministic in-process rail. The "transaction hash" is keccak256 of the
 * idempotency key, so the same payout always produces the same hash and no
 * value ever leaves anywhere. Payouts made with it are labelled SIMULATED.
 */
export class MockPaymentRail implements PaymentRail {
  readonly name = 'mock'
  readonly simulated = true

  async assertCanReserve(): Promise<void> {}

  async signTransfer(idempotencyKey: string, to: Address, amountMicro: bigint): Promise<SignedTransfer> {
    const rawTx = toHex(`mock-transfer:${idempotencyKey}:${to}:${amountMicro}`)
    return { rawTx, txHash: keccak256(rawTx) }
  }

  async broadcast(): Promise<void> {}

  async confirmation(_txHash: Hex): Promise<'confirmed'> {
    return 'confirmed'
  }
}
