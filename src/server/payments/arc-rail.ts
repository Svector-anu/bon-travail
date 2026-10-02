import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  TransactionReceiptNotFoundError,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import type { Address, Hex } from '@/domain/types'
import { ARC_TESTNET_CHAIN_ID, ARC_USDC_ADDRESS, arcTestnet } from '../chain/arc'
import { PaymentConfigError, PaymentRailError, type PaymentRail, type SignedTransfer } from './payment-provider'

const NATIVE_TO_MICRO = 10n ** 12n
/** Keep this much USDC aside for gas on top of every reservation. */
const GAS_BUFFER_MICRO = 50_000n

function isAlreadyKnown(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('already known') || message.includes('nonce too low')
}

/**
 * Pays rewards as ERC-20 USDC transfers on Arc Testnet from a single hot
 * wallet. The wallet only ever needs to hold the capped reward float; it must
 * never be a treasury key.
 */
export class ArcPaymentRail implements PaymentRail {
  readonly name = 'arc-testnet'
  readonly simulated = false
  readonly payer: Address
  private readonly account: PrivateKeyAccount
  private readonly publicClient: PublicClient

  constructor(options: { rpcUrl: string; explorerUrl: string; privateKey: string | undefined }) {
    if (!options.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) {
      throw new PaymentConfigError('PAYMENT_PROVIDER=arc requires ARC_PAYER_PRIVATE_KEY (0x + 64 hex)')
    }
    const chain = arcTestnet(options.rpcUrl, options.explorerUrl)
    const transport = http(options.rpcUrl, { timeout: 15_000, retryCount: 1 })
    this.account = privateKeyToAccount(options.privateKey as Hex)
    this.payer = this.account.address
    this.publicClient = createPublicClient({ chain, transport })
  }

  async assertCanReserve(totalReservedMicro: bigint): Promise<void> {
    let balanceMicro: bigint
    try {
      balanceMicro = (await this.publicClient.getBalance({ address: this.payer })) / NATIVE_TO_MICRO
    } catch (error) {
      throw new PaymentRailError('could not read payer balance', { cause: error })
    }
    if (balanceMicro < totalReservedMicro + GAS_BUFFER_MICRO) {
      throw new PaymentRailError(
        `payer ${this.payer} holds ${balanceMicro} micro-USDC, needs ${totalReservedMicro + GAS_BUFFER_MICRO}`,
      )
    }
  }

  async signTransfer(_idempotencyKey: string, to: Address, amountMicro: bigint): Promise<SignedTransfer> {
    try {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amountMicro] })
      const [nonce, fees, gas] = await Promise.all([
        this.publicClient.getTransactionCount({ address: this.payer, blockTag: 'pending' }),
        this.publicClient.estimateFeesPerGas(),
        this.publicClient.estimateGas({ account: this.payer, to: ARC_USDC_ADDRESS, data }),
      ])
      const rawTx = await this.account.signTransaction({
        type: 'eip1559',
        chainId: ARC_TESTNET_CHAIN_ID,
        to: ARC_USDC_ADDRESS,
        data,
        nonce,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      })
      return { rawTx, txHash: keccak256(rawTx) }
    } catch (error) {
      throw new PaymentRailError('could not prepare USDC transfer', { cause: error })
    }
  }

  async broadcast(signed: SignedTransfer): Promise<void> {
    try {
      await this.publicClient.sendRawTransaction({ serializedTransaction: signed.rawTx })
    } catch (error) {
      if (isAlreadyKnown(error)) return
      throw new PaymentRailError('broadcast failed', { cause: error })
    }
  }

  async confirmation(txHash: Hex): Promise<'confirmed' | 'pending' | 'failed'> {
    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash })
      return receipt.status === 'success' ? 'confirmed' : 'failed'
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return 'pending'
      throw new PaymentRailError('could not read payout receipt', { cause: error })
    }
  }
}
