import {
  createPublicClient,
  http,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type PublicClient,
} from 'viem'
import type { Hex } from '@/domain/types'
import { ARC_USDC_ADDRESS, ERC20_TRANSFER_SELECTOR, arcTestnet, extractTransfer } from './arc'
import { ChainUnavailableError, type ChainReader, type TransferRead } from './chain-reader'

const BLOCK_SCAN_DEPTH = 20n

export class ArcRpcChainReader implements ChainReader {
  readonly chainLabel = 'Arc Testnet'
  readonly explorerUrl: string
  private readonly client: PublicClient

  constructor(rpcUrl: string, explorerUrl: string) {
    this.explorerUrl = explorerUrl
    this.client = createPublicClient({
      chain: arcTestnet(rpcUrl, explorerUrl),
      transport: http(rpcUrl, { timeout: 10_000, retryCount: 2 }),
    })
  }

  async readTransfer(txHash: Hex): Promise<TransferRead> {
    try {
      const [tx, receipt] = await Promise.all([
        this.client.getTransaction({ hash: txHash }),
        this.client.getTransactionReceipt({ hash: txHash }),
      ])
      return extractTransfer(tx, receipt)
    } catch (error) {
      if (error instanceof TransactionNotFoundError || error instanceof TransactionReceiptNotFoundError) {
        return { kind: 'not_found' }
      }
      throw new ChainUnavailableError(`Arc RPC read failed for ${txHash}`, { cause: error })
    }
  }

  async latestBlockNumber(): Promise<bigint> {
    try {
      return await this.client.getBlockNumber()
    } catch (error) {
      throw new ChainUnavailableError('Arc RPC block number read failed', { cause: error })
    }
  }

  async recentTransferCandidates(limit: number): Promise<Hex[]> {
    try {
      const latest = await this.client.getBlockNumber()
      const candidates: Hex[] = []
      for (let n = latest; n > latest - BLOCK_SCAN_DEPTH && candidates.length < limit; n--) {
        const block = await this.client.getBlock({ blockNumber: n, includeTransactions: true })
        for (const tx of block.transactions) {
          const isUsdcTransferCall =
            tx.to?.toLowerCase() === ARC_USDC_ADDRESS.toLowerCase() &&
            tx.input.startsWith(ERC20_TRANSFER_SELECTOR)
          if (isUsdcTransferCall) candidates.push(tx.hash)
          if (candidates.length >= limit) break
        }
      }
      return candidates
    } catch (error) {
      throw new ChainUnavailableError('Arc RPC block scan failed', { cause: error })
    }
  }
}
