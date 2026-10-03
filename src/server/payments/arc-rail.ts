import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import type { Address, Hex } from '@/domain/types'
import { ARC_TESTNET_CHAIN_ID, ARC_USDC_ADDRESS, arcTestnet } from '../chain/arc'
import {
  PaymentConfigError,
  PaymentRailError,
  type PaymentRail,
  type RailCall,
  type SignedTransfer,
} from './payment-provider'

const NATIVE_TO_MICRO = 10n ** 12n
/** Keep this much USDC aside for gas on top of every reservation. */
const GAS_BUFFER_MICRO = 50_000n
const CONFIRM_TIMEOUT_MS = 20_000

export const PROOFWORK_ESCROW_ABI = parseAbi([
  'function fund(bytes32 taskId, uint256 amount, uint64 deadline)',
  'function release(bytes32 taskId, address worker)',
  'function refund(bytes32 taskId)',
  'function escrows(bytes32 taskId) view returns (uint256 amount, uint64 deadline, uint8 status)',
  'function operator() view returns (address)',
  'function usdc() view returns (address)',
  'function maxReward() view returns (uint256)',
])

/**
 * On-chain key for a task. Task ids restart in every database, so the key is
 * namespaced per deployment: two deployments sharing one escrow contract can
 * never fund, pay or refund each other's task_001.
 */
export function escrowTaskKey(taskId: string, namespace = 'proofwork'): Hex {
  return keccak256(stringToHex(`${namespace}:${taskId}`))
}

function isAlreadyKnown(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('already known') || message.includes('nonce too low')
}

interface ArcOptions {
  rpcUrl: string
  explorerUrl: string
  privateKey: string | undefined
}

/** Signing, broadcast and confirmation shared by both Arc rails. */
abstract class ArcSigner {
  readonly payer: Address
  protected readonly account: PrivateKeyAccount
  protected readonly client: PublicClient

  constructor(options: ArcOptions) {
    if (!options.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) {
      throw new PaymentConfigError('Arc payments require ARC_PAYER_PRIVATE_KEY (0x + 64 hex)')
    }
    this.account = privateKeyToAccount(options.privateKey as Hex)
    this.payer = this.account.address
    this.client = createPublicClient({
      chain: arcTestnet(options.rpcUrl, options.explorerUrl),
      transport: http(options.rpcUrl, { timeout: 15_000, retryCount: 1 }),
    })
  }

  protected async balanceMicro(): Promise<bigint> {
    try {
      return (await this.client.getBalance({ address: this.payer })) / NATIVE_TO_MICRO
    } catch (error) {
      throw new PaymentRailError('could not read payer balance', { cause: error })
    }
  }

  protected async requireBalance(neededMicro: bigint): Promise<void> {
    const balance = await this.balanceMicro()
    if (balance < neededMicro + GAS_BUFFER_MICRO) {
      throw new PaymentRailError(`payer ${this.payer} holds ${balance} micro-USDC, needs ${neededMicro + GAS_BUFFER_MICRO}`)
    }
  }

  protected async signCall(to: Address, data: Hex): Promise<SignedTransfer> {
    try {
      const [nonce, fees, gas] = await Promise.all([
        this.client.getTransactionCount({ address: this.payer, blockTag: 'pending' }),
        this.client.estimateFeesPerGas(),
        this.client.estimateGas({ account: this.payer, to, data }),
      ])
      const rawTx = await this.account.signTransaction({
        type: 'eip1559',
        chainId: ARC_TESTNET_CHAIN_ID,
        to,
        data,
        nonce,
        gas: (gas * 12n) / 10n,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      })
      return { rawTx, txHash: keccak256(rawTx) }
    } catch (error) {
      throw new PaymentRailError('could not prepare Arc transaction', { cause: error })
    }
  }

  async broadcast(signed: SignedTransfer): Promise<void> {
    try {
      await this.client.sendRawTransaction({ serializedTransaction: signed.rawTx })
    } catch (error) {
      if (isAlreadyKnown(error)) return
      throw new PaymentRailError('broadcast failed', { cause: error })
    }
  }

  /** Arc finalises in about a second, so wait briefly before calling it pending. */
  async confirmation(txHash: Hex): Promise<'confirmed' | 'pending' | 'failed'> {
    try {
      const receipt = await this.client.waitForTransactionReceipt({ hash: txHash, timeout: CONFIRM_TIMEOUT_MS })
      return receipt.status === 'success' ? 'confirmed' : 'failed'
    } catch (error) {
      if (error instanceof WaitForTransactionReceiptTimeoutError || error instanceof TransactionReceiptNotFoundError) {
        return 'pending'
      }
      throw new PaymentRailError('could not read transaction receipt', { cause: error })
    }
  }
}

/**
 * Pays rewards as direct USDC transfers from a capped hot wallet. Funding and
 * refunds are ledger reservations against that wallet's balance.
 */
export class ArcPaymentRail extends ArcSigner implements PaymentRail {
  readonly name = 'arc-testnet'
  readonly simulated = false
  readonly onchainEscrow = false

  async assertCanReserve(amounts: { newMicro: bigint; outstandingMicro: bigint }): Promise<void> {
    await this.requireBalance(amounts.newMicro + amounts.outstandingMicro)
  }

  async sign(call: RailCall): Promise<SignedTransfer> {
    if (call.kind !== 'release' || !call.to) throw new PaymentRailError(`direct rail only signs releases, got ${call.kind}`)
    return this.signCall(
      ARC_USDC_ADDRESS,
      encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [call.to, call.amountMicro] }),
    )
  }
}

/**
 * Moves every reward through the ProofworkEscrow contract: fund pulls USDC
 * from the operator into escrow, release pays the worker, refund returns it
 * after the deadline. The operator's USDC approval to the contract is capped
 * at the outstanding-escrow limit, so the contract can never pull more.
 */
export class ArcEscrowRail extends ArcSigner implements PaymentRail {
  readonly name = 'arc-escrow'
  readonly simulated = false
  readonly onchainEscrow = true
  readonly escrow: Address
  private readonly allowanceCapMicro: bigint

  private readonly namespace: string

  constructor(options: ArcOptions & { escrowAddress: string | undefined; allowanceCapMicro: bigint; namespace?: string }) {
    super(options)
    this.namespace = options.namespace ?? 'proofwork'
    if (!options.escrowAddress || !/^0x[0-9a-fA-F]{40}$/.test(options.escrowAddress)) {
      throw new PaymentConfigError('PAYMENT_PROVIDER=arc-escrow requires ARC_ESCROW_ADDRESS')
    }
    this.escrow = getAddress(options.escrowAddress)
    this.allowanceCapMicro = options.allowanceCapMicro
  }

  async assertCanReserve(amounts: { newMicro: bigint }): Promise<void> {
    await this.requireBalance(amounts.newMicro)
  }

  async beforeSign(call: RailCall): Promise<void> {
    if (call.kind === 'fund') await this.ensureAllowance(call.amountMicro)
    if (call.kind === 'refund') {
      const block = await this.client.getBlock({ blockTag: 'latest' })
      if (Number(block.timestamp) * 1000 < call.deadlineMs) {
        throw new PaymentRailError('chain clock has not reached the task deadline yet; refund will retry')
      }
    }
  }

  async sign(call: RailCall): Promise<SignedTransfer> {
    const taskKey = escrowTaskKey(call.taskId, this.namespace)
    switch (call.kind) {
      case 'fund':
        return this.signCall(
          this.escrow,
          encodeFunctionData({
            abi: PROOFWORK_ESCROW_ABI,
            functionName: 'fund',
            args: [taskKey, call.amountMicro, BigInt(Math.ceil(call.deadlineMs / 1000))],
          }),
        )
      case 'release':
        if (!call.to) throw new PaymentRailError('release needs a worker address')
        return this.signCall(
          this.escrow,
          encodeFunctionData({ abi: PROOFWORK_ESCROW_ABI, functionName: 'release', args: [taskKey, call.to] }),
        )
      case 'refund':
        return this.signCall(
          this.escrow,
          encodeFunctionData({ abi: PROOFWORK_ESCROW_ABI, functionName: 'refund', args: [taskKey] }),
        )
    }
  }

  private async ensureAllowance(amountMicro: bigint): Promise<void> {
    const allowance = await this.client.readContract({
      address: ARC_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [this.payer, this.escrow],
    })
    if (allowance >= amountMicro) return
    const approve = await this.signCall(
      ARC_USDC_ADDRESS,
      encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [this.escrow, this.allowanceCapMicro] }),
    )
    await this.broadcast(approve)
    if ((await this.confirmation(approve.txHash)) !== 'confirmed') {
      throw new PaymentRailError(`USDC approval ${approve.txHash} not confirmed yet; funding will retry`)
    }
  }
}
