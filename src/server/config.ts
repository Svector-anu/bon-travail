import { usdcFromConfig } from '@/domain/money'
import { PaymentConfigError } from './payments/payment-provider'

export interface AppConfig {
  databasePath: string
  chainReader: 'rpc' | 'fixture'
  arcRpcUrl: string
  arcExplorerUrl: string
  paymentProvider: 'mock' | 'arc'
  arcPayerPrivateKey: string | undefined
  maxRewardMicro: bigint
  dailyPayoutCapMicro: bigint
  maxOutstandingEscrowMicro: bigint
  agentApiToken: string | undefined
  taskRewardMicro: bigint
  taskDeadlineMs: number
  claimTtlMs: number
  targetOpenTasks: number
  agentExpectedIntervalMs: number
  publicBaseUrl: string
}

type Env = Record<string, string | undefined>

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`)
  return value
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback?: T): T {
  const raw = env[name] ?? fallback
  if (raw === undefined || !allowed.includes(raw as T)) {
    throw new PaymentConfigError(`${name} must be one of ${allowed.join(', ')}; got ${raw === undefined ? 'nothing' : `"${raw}"`}`)
  }
  return raw as T
}

/**
 * Reads configuration once. Payment settings fail closed: there is no default
 * provider, so a missing PAYMENT_PROVIDER stops the app from moving money
 * instead of silently picking one.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const config: AppConfig = {
    databasePath: env.DATABASE_PATH || './data/proofwork.db',
    chainReader: oneOf(env, 'CHAIN_READER', ['rpc', 'fixture'] as const, 'rpc'),
    arcRpcUrl: env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
    arcExplorerUrl: env.ARC_EXPLORER_URL || 'https://testnet.arcscan.app',
    paymentProvider: oneOf(env, 'PAYMENT_PROVIDER', ['mock', 'arc'] as const),
    arcPayerPrivateKey: env.ARC_PAYER_PRIVATE_KEY || undefined,
    maxRewardMicro: usdcFromConfig(env.MAX_REWARD_USDC ?? '1', 'MAX_REWARD_USDC'),
    dailyPayoutCapMicro: usdcFromConfig(env.DAILY_PAYOUT_CAP_USDC ?? '10', 'DAILY_PAYOUT_CAP_USDC'),
    maxOutstandingEscrowMicro: usdcFromConfig(env.MAX_OUTSTANDING_ESCROW_USDC ?? '5', 'MAX_OUTSTANDING_ESCROW_USDC'),
    agentApiToken: env.AGENT_API_TOKEN || undefined,
    taskRewardMicro: usdcFromConfig(env.TASK_REWARD_USDC ?? '1', 'TASK_REWARD_USDC'),
    taskDeadlineMs: positiveInt(env, 'TASK_DEADLINE_SECONDS', 6 * 60 * 60) * 1000,
    claimTtlMs: positiveInt(env, 'CLAIM_TTL_SECONDS', 10 * 60) * 1000,
    targetOpenTasks: positiveInt(env, 'TARGET_OPEN_TASKS', 1),
    agentExpectedIntervalMs: positiveInt(env, 'AGENT_EXPECTED_INTERVAL_SECONDS', 300) * 1000,
    publicBaseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  }

  if (config.taskRewardMicro > config.maxRewardMicro) {
    throw new PaymentConfigError('TASK_REWARD_USDC exceeds MAX_REWARD_USDC')
  }
  if (config.paymentProvider === 'arc' && !config.arcPayerPrivateKey) {
    throw new PaymentConfigError('PAYMENT_PROVIDER=arc requires ARC_PAYER_PRIVATE_KEY')
  }
  if (config.agentApiToken !== undefined && config.agentApiToken.length < 32) {
    throw new Error('AGENT_API_TOKEN must be at least 32 characters')
  }
  return config
}
