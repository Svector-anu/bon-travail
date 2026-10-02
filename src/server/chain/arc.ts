import { defineChain, getAddress, parseAbiItem, type Log } from 'viem'
import type { Address, TransferFact } from '@/domain/types'
import type { TransferRead } from './chain-reader'

export const ARC_TESTNET_CHAIN_ID = 5_042_002

/** Arc exposes native USDC through an ERC-20 interface at this address (6 decimals). */
export const ARC_USDC_ADDRESS: Address = '0x3600000000000000000000000000000000000000'

/** Native USDC balances use 18 decimals; the ERC-20 view uses 6. */
const NATIVE_TO_MICRO = 10n ** 12n

export const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
export const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'

export function arcTestnet(rpcUrl: string, explorerUrl: string) {
  return defineChain({
    id: ARC_TESTNET_CHAIN_ID,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: 'Arcscan', url: explorerUrl } },
    testnet: true,
  })
}

interface RawTx {
  from: Address
  to: Address | null
  value: bigint
  input: string
  blockNumber: bigint | null
}

interface RawReceipt {
  status: 'success' | 'reverted'
  logs: readonly Pick<Log, 'address' | 'topics' | 'data'>[]
  blockNumber: bigint
}

function topicToAddress(topic: string | undefined): Address | null {
  if (!topic || topic.length !== 66) return null
  return getAddress(`0x${topic.slice(26)}`)
}

/**
 * Deterministic extraction of "who received how much USDC" from a mined
 * transaction. Exactly one USDC Transfer log wins; with none, a plain
 * native-value transfer is accepted when it converts to whole micro-units.
 * Everything else is ambiguous and never becomes a task.
 */
export function extractTransfer(tx: RawTx, receipt: RawReceipt): TransferRead {
  if (receipt.status !== 'success') return { kind: 'failed_tx' }

  const usdcLogs = receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === ARC_USDC_ADDRESS.toLowerCase() &&
      log.topics[0]?.toLowerCase() === TRANSFER_TOPIC,
  )

  if (usdcLogs.length > 1) {
    return { kind: 'ambiguous', reason: `transaction emitted ${usdcLogs.length} USDC transfers` }
  }

  if (usdcLogs.length === 1) {
    const log = usdcLogs[0]!
    const from = topicToAddress(log.topics[1])
    const to = topicToAddress(log.topics[2])
    if (!from || !to || !log.data || log.data === '0x') {
      return { kind: 'ambiguous', reason: 'USDC Transfer log is malformed' }
    }
    return {
      kind: 'ok',
      fact: {
        recipient: to,
        amountMicro: BigInt(log.data),
        from,
        blockNumber: receipt.blockNumber,
        source: 'erc20-transfer-log',
      } satisfies TransferFact,
    }
  }

  if (tx.to && tx.value > 0n && tx.input === '0x') {
    if (tx.value % NATIVE_TO_MICRO !== 0n) {
      return { kind: 'ambiguous', reason: 'native amount is not a whole number of USDC micro-units' }
    }
    return {
      kind: 'ok',
      fact: {
        recipient: getAddress(tx.to),
        amountMicro: tx.value / NATIVE_TO_MICRO,
        from: getAddress(tx.from),
        blockNumber: receipt.blockNumber,
        source: 'native-value',
      },
    }
  }

  return { kind: 'ambiguous', reason: 'transaction moved no USDC' }
}
