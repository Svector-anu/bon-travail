import type { Hex, TransferFact } from '@/domain/types'

export type TransferRead =
  | { kind: 'ok'; fact: TransferFact }
  | { kind: 'not_found' }
  | { kind: 'failed_tx' }
  | { kind: 'ambiguous'; reason: string }

/** Raised when the chain could not be read at all. Callers retry later. */
export class ChainUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ChainUnavailableError'
  }
}

export interface ChainReader {
  readonly chainLabel: string
  readonly explorerUrl: string
  /** Reads the single USDC transfer performed by a transaction. */
  readTransfer(txHash: Hex): Promise<TransferRead>
  /** Recent transaction hashes that look like plain USDC transfers, newest first. */
  recentTransferCandidates(limit: number): Promise<Hex[]>
}
