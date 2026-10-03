import { privateKeyToAccount } from 'viem/accounts'
import { ArcRpcChainReader } from './chain/arc-rpc-reader'
import type { ChainReader } from './chain/chain-reader'
import { FixtureChainReader } from './chain/fixture-reader'
import { systemClock, type Clock } from './clock'
import { loadConfig, type AppConfig } from './config'
import { RestGitHubClient, type GitHubClient } from './github/client'
import { OpenIdentityVerifier, PrivyIdentityVerifier, type IdentityVerifier } from './identity'
import { ArcEscrowRail, ArcPaymentRail } from './payments/arc-rail'
import { LedgerPaymentProvider } from './payments/ledger-provider'
import { MockPaymentRail } from './payments/mock-rail'
import type { PaymentProvider, PaymentRail } from './payments/payment-provider'
import { Agent } from './services/agent'
import { Observer } from './services/observer'
import { TaskService } from './services/task-service'
import { WorkService } from './services/work-service'
import { Store } from './store/store'
import { WatchStore } from './store/watch-store'
import { CiFixVerifier } from './verification/ci-verifier'
import { TxFactVerifier } from './verification/tx-fact-verifier'
import { VerifierRegistry } from './verification/verifier'

export interface App {
  config: AppConfig
  store: Store
  watch: WatchStore
  chain: ChainReader
  github: GitHubClient | null
  payments: PaymentProvider
  tasks: TaskService
  work: WorkService
  agent: Agent
  clock: Clock
  identity: IdentityVerifier
}

export interface AppOverrides {
  chain?: ChainReader
  rail?: PaymentRail
  clock?: Clock
  identity?: IdentityVerifier
  github?: GitHubClient | null
}

function defaultChain(config: AppConfig): ChainReader {
  return config.chainReader === 'fixture'
    ? new FixtureChainReader(config.arcExplorerUrl)
    : new ArcRpcChainReader(config.arcRpcUrl, config.arcExplorerUrl)
}

function defaultRail(config: AppConfig): PaymentRail {
  const arc = { rpcUrl: config.arcRpcUrl, explorerUrl: config.arcExplorerUrl, privateKey: config.arcPayerPrivateKey }
  switch (config.paymentProvider) {
    case 'arc-escrow':
      return new ArcEscrowRail({
        ...arc,
        escrowAddress: config.arcEscrowAddress,
        allowanceCapMicro: config.maxOutstandingEscrowMicro,
        namespace: config.escrowNamespace,
      })
    case 'arc':
      return new ArcPaymentRail(arc)
    default:
      return new MockPaymentRail()
  }
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

function operatorAddress(config: AppConfig): string | null {
  const key = config.arcPayerPrivateKey
  return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as `0x${string}`).address : null
}

/** Wires the services around one store. Tests pass a fresh in-memory store per case. */
export function createApp(config: AppConfig, store: Store, overrides: AppOverrides = {}): App {
  const clock = overrides.clock ?? systemClock
  const identity = overrides.identity ?? defaultIdentity(config)
  const watch = new WatchStore(store.database, store.transactions)
  const chain = overrides.chain ?? defaultChain(config)
  const github = overrides.github !== undefined ? overrides.github : config.githubToken ? new RestGitHubClient(config.githubToken) : null
  const payments = new LedgerPaymentProvider(
    store,
    overrides.rail ?? defaultRail(config),
    {
      maxRewardMicro: config.maxRewardMicro,
      dailyPayoutCapMicro: config.dailyPayoutCapMicro,
      maxOutstandingEscrowMicro: config.maxOutstandingEscrowMicro,
    },
    clock,
  )
  const verifiers = new VerifierRegistry([new TxFactVerifier(chain, clock), new CiFixVerifier(github, clock, config.ciVerifyGraceMs)])
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
  const observer = github ? new Observer(watch, github, clock) : null
  const work = new WorkService(watch, tasks, observer, github, clock, {
    maxRewardMicro: config.maxRewardMicro,
    operatorAddress: operatorAddress(config),
    escrowAddress: config.arcEscrowAddress ?? null,
  })
  const agent = new Agent(
    store,
    watch,
    tasks,
    work,
    chain,
    payments,
    clock,
    {
      targetOpenTasks: config.targetOpenTasks,
      expectedIntervalMs: config.agentExpectedIntervalMs,
      observeIntervalMs: config.observeIntervalMs,
      chainReaderLabel: config.chainReader === 'fixture' ? 'Arc Testnet (recorded fixtures)' : 'Arc Testnet RPC',
      publicBaseUrl: config.publicBaseUrl,
    },
    github !== null,
  )
  return { config, store, watch, chain, github, payments, tasks, work, agent, clock, identity }
}

const globalForStore = globalThis as typeof globalThis & { proofworkStore?: Promise<Store> }

/**
 * Process-wide instance for route handlers and scripts. Only the database
 * connection is pinned to globalThis; services are rebuilt when a dev hot
 * reload re-evaluates this module, so they never mix class identities with
 * freshly loaded code.
 */
let app: Promise<App> | undefined

export function getApp(): Promise<App> {
  app ??= (async () => {
    const config = loadConfig()
    globalForStore.proofworkStore ??= Store.open(config.database)
    try {
      return createApp(config, await globalForStore.proofworkStore)
    } catch (error) {
      globalForStore.proofworkStore = undefined
      app = undefined
      throw error
    }
  })()
  return app
}
