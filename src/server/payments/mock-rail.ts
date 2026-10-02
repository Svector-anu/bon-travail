import { keccak256, toHex } from 'viem'
import type { Hex } from '@/domain/types'
import type { PaymentRail, RailCall, SignedTransfer } from './payment-provider'

/**
 * Deterministic in-process rail. The "transaction hash" is keccak256 of the
 * idempotency key, so the same payout always produces the same hash and no
 * value ever leaves anywhere. Payouts made with it are labelled SIMULATED.
 */
export class MockPaymentRail implements PaymentRail {
  readonly name = 'mock'
  readonly simulated = true
  readonly onchainEscrow: boolean = false

  async assertCanReserve(): Promise<void> {}

  async sign(call: RailCall): Promise<SignedTransfer> {
    const rawTx = toHex(`mock-${call.kind}:${call.idempotencyKey}:${call.to ?? 'agent'}:${call.amountMicro}`)
    return { rawTx, txHash: keccak256(rawTx) }
  }

  async broadcast(): Promise<void> {}

  async confirmation(_txHash: Hex): Promise<'confirmed'> {
    return 'confirmed'
  }
}
