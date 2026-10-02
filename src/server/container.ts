import { ArcRpcChainReader } from './chain/arc-rpc-reader'
import type { ChainReader } from './chain/chain-reader'
import { FixtureChainReader } from './chain/fixture-reader'
import { systemClock, type Clock } from './clock'
import { loadConfig, type AppConfig } from './config'
import { OpenIdentityVerifier, PrivyIdentityVerifier, type IdentityVerifier } from './identity'
import { ArcPaymentRail } from './payments/arc-rail'
import { LedgerPaymentProvider } from './payments/ledger-provider'
import { MockPaymentRail } from './payments/mock-rail'
import type { PaymentProvider, PaymentRail } from './payments/payment-provider'
import { Agent } from './services/agent'
import { TaskService } from './services/task-service'
import { Store } from './store/store'
import { TxFactVerifier } from './verification/tx-fact-verifier'
import { VerifierRegistry } from './verification/verifier'

export interface App {
  config: AppConfig
  store: Store
  chain: ChainReader
  payments: PaymentProvider
  tasks: TaskService
  agent: Agent
  clock: Clock
  identity: IdentityVerifier
}

export interface AppOverrides {
  store?: Store
  chain?: ChainReader
  rail?: PaymentRail
  clock?: Clock
  identity?: IdentityVerifier
}

function defaultChain(config: AppConfig): ChainReader {
  return config.chainReader === 'fixture'
    ? new FixtureChainReader(config.arcExplorerUrl)
    : new ArcRpcChainReader(config.arcRpcUrl, config.arcExplorerUrl)
}

function defaultRail(config: AppConfig): PaymentRail {
  return config.paymentProvider === 'arc'
    ? new ArcPaymentRail({ rpcUrl: config.arcRpcUrl, explorerUrl: config.arcExplorerUrl, privateKey: config.arcPayerPrivateKey })
    : new MockPaymentRail()
}

function defaultIdentity(config: AppConfig): IdentityVerifier {
  return config.privyAppId && config.privyAppSecret
    ? new PrivyIdentityVerifier({
        appId: config.privyAppId,
        appSecret: config.privyAppSecret,
        verificationKey: config.privyVerificationKey,
      })
    : new OpenIdentityVerifier()
}

export function createApp(config: AppConfig, overrides: AppOverrides = {}): App {
  const clock = overrides.clock ?? systemClock
  const identity = overrides.identity ?? defaultIdentity(config)
  const store = overrides.store ?? new Store(config.databasePath)
  const chain = overrides.chain ?? defaultChain(config)
  const payments = new LedgerPaymentProvider(store, overrides.rail ?? defaultRail(config), {
    maxRewardMicro: config.maxRewardMicro,
    dailyPayoutCapMicro: config.dailyPayoutCapMicro,
    maxOutstandingEscrowMicro: config.maxOutstandingEscrowMicro,
  }, clock)
  const verifiers = new VerifierRegistry([new TxFactVerifier(chain, clock)])
  const tasks = new TaskService(
    store,
    chain,
    verifiers,
    payments,
    clock,
    {
      rewardMicro: config.taskRewardMicro,
      deadlineMs: config.taskDeadlineMs,
      claimTtlMs: config.claimTtlMs,
      chainLabel: chain.chainLabel,
      identityRequired: identity.required,
    },
    { explorerUrl: chain.explorerUrl },
  )
  const agent = new Agent(store, tasks, chain, payments, clock, {
    targetOpenTasks: config.targetOpenTasks,
    expectedIntervalMs: config.agentExpectedIntervalMs,
    chainReaderLabel: config.chainReader === 'fixture' ? 'Arc Testnet (recorded fixtures)' : 'Arc Testnet RPC',
    publicBaseUrl: config.publicBaseUrl,
  })
  return { config, store, chain, payments, tasks, agent, clock, identity }
}

const globalForStore = globalThis as typeof globalThis & { proofworkStore?: Store }
let app: App | undefined

/**
 * Process-wide instance for route handlers and scripts. Only the database
 * connection is pinned to globalThis; services are rebuilt when a dev hot
 * reload re-evaluates this module, so they never mix class identities with
 * freshly loaded code.
 */
export function getApp(): App {
  if (!app) {
    const config = loadConfig()
    globalForStore.proofworkStore ??= new Store(config.databasePath)
    app = createApp(config, { store: globalForStore.proofworkStore })
  }
  return app
}
