import { checkAddress } from '@/domain/address'
import { formatUsdc, parseUsdc } from '@/domain/money'
import {
  TASK_KIND_TX_FACT_CHECK,
  type FieldComparison,
  type Submission,
  type TaskRecord,
  type TransferFact,
  type VerificationResult,
} from '@/domain/types'
import { ChainUnavailableError, type ChainReader } from '../chain/chain-reader'
import type { Clock } from '../clock'
import { VerificationUnavailableError, type TaskVerifier } from './verifier'

export const TX_FACT_VERIFIER_NAME = 'arc-usdc-transfer/v1'

function sameFact(a: TransferFact, b: TransferFact): boolean {
  return a.recipient === b.recipient && a.amountMicro === b.amountMicro && a.from === b.from
}

/**
 * Re-reads the task's transaction from the chain and compares the submitted
 * recipient and amount for exact equality. Addresses compare by canonical
 * (checksummed) form, amounts by integer USDC micro-units.
 */
export class TxFactVerifier implements TaskVerifier {
  readonly kind = TASK_KIND_TX_FACT_CHECK
  readonly name = TX_FACT_VERIFIER_NAME

  constructor(
    private readonly chain: ChainReader,
    private readonly clock: Clock,
  ) {}

  async verify(task: TaskRecord, submission: Submission): Promise<VerificationResult> {
    let read
    try {
      read = await this.chain.readTransfer(task.txHash)
    } catch (error) {
      if (error instanceof ChainUnavailableError) {
        throw new VerificationUnavailableError('chain unavailable', { cause: error })
      }
      throw error
    }
    if (read.kind !== 'ok') {
      throw new VerificationUnavailableError(`chain returned ${read.kind} for ${task.txHash}`)
    }
    if (!sameFact(read.fact, task.expected)) {
      throw new VerificationUnavailableError('chain data no longer matches the task snapshot')
    }

    const fact = read.fact
    const expected = { recipient: fact.recipient, amount: formatUsdc(fact.amountMicro) }
    const submitted = { recipient: submission.recipient.trim(), amount: submission.amount.trim() }
    const base = {
      expected,
      submitted,
      verifier: this.name,
      checkedAt: this.clock.now(),
      chainBlock: fact.blockNumber.toString(),
    }

    const address = checkAddress(submission.recipient)
    const amountMicro = parseUsdc(submission.amount)
    if (!address.ok || amountMicro === null) {
      const problems = [
        address.ok ? null : `recipient is ${address.reason}`,
        amountMicro === null ? 'amount is not a plain decimal with at most 6 places' : null,
      ].filter((p): p is string => p !== null)
      return {
        ...base,
        valid: false,
        code: 'MALFORMED_SUBMISSION',
        reason: `Submission could not be read: ${problems.join('; ')}.`,
        fields: [],
      }
    }

    const fields: FieldComparison[] = [
      {
        field: 'recipient',
        expected: fact.recipient,
        submitted: address.address,
        match: address.address === fact.recipient,
      },
      {
        field: 'amount',
        expected: formatUsdc(fact.amountMicro),
        submitted: formatUsdc(amountMicro),
        match: amountMicro === fact.amountMicro,
      },
    ]
    const mismatched = fields.filter((f) => !f.match).map((f) => f.field)

    if (mismatched.length === 0) {
      return {
        ...base,
        valid: true,
        code: 'MATCH',
        reason: `Recipient and amount exactly match the USDC Transfer in block ${fact.blockNumber}.`,
        fields,
      }
    }
    return {
      ...base,
      valid: false,
      code: 'MISMATCH',
      reason: `${mismatched.map((f) => (f === 'recipient' ? 'Recipient' : 'Amount')).join(' and ')} ${
        mismatched.length > 1 ? 'do' : 'does'
      } not match the on-chain transfer.`,
      fields,
    }
  }
}
