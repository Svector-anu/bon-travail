import type { Viewer } from '@/server/access'
import { formatUsdc } from '@/domain/money'
import type { Address, Hex } from '@/domain/types'
import type { ChainReader, TransferRead } from '@/server/chain/chain-reader'
import { ChainUnavailableError } from '@/server/chain/chain-reader'
import { ARC_TESTNET_FIXTURES, FixtureChainReader } from '@/server/chain/fixture-reader'
import { ManualClock } from '@/server/clock'
import { loadConfig } from '@/server/config'
import { createApp, type App } from '@/server/container'
import type { GitHubClient } from '@/server/github/client'
import type { IdentityVerifier } from '@/server/identity'
import { MockPaymentRail } from '@/server/payments/mock-rail'
import { PaymentRailError, type PaymentRail, type RailCall } from '@/server/payments/payment-provider'
import { Store } from '@/server/store/store'

export const T0 = Date.parse('2026-10-02T09:00:00Z')
export const WORKER_A: Address = '0x1111111111111111111111111111111111111111'
export const WORKER_B: Address = '0x2222222222222222222222222222222222222222'
export const FIXTURE = ARC_TESTNET_FIXTURES[0]!
export const FIXTURE_2 = ARC_TESTNET_FIXTURES[1]!

export const correctAnswer = (fixture = FIXTURE) => ({
  recipient: fixture.recipient,
  amount: formatUsdc(fixture.amountMicro),
})

export const TEST_ENV = {
  DATABASE_PATH: ':memory:',
  CHAIN_READER: 'fixture',
  PAYMENT_PROVIDER: 'mock',
  AGENT_API_TOKEN: 'test-token-test-token-test-token-0000',
  OWNER_ACCESS_TOKEN: 'owner-token-owner-token-owner-token-0000',
  MAX_REWARD_USDC: '1',
  DAILY_PAYOUT_CAP_USDC: '10',
  MAX_OUTSTANDING_ESCROW_USDC: '5',
  TASK_REWARD_USDC: '1',
  TASK_DEADLINE_SECONDS: '21600',
  CLAIM_TTL_SECONDS: '600',
  TARGET_OPEN_TASKS: '1',
  PUBLIC_BASE_URL: 'https://proofwork.test',
}

/** Chain reader that can be switched off to simulate an RPC outage. */
export class SwitchableChain implements ChainReader {
  readonly chainLabel: string
  readonly explorerUrl: string
  down = false
  private readonly inner = new FixtureChainReader('https://testnet.arcscan.app')

  constructor() {
    this.chainLabel = this.inner.chainLabel
    this.explorerUrl = this.inner.explorerUrl
  }

  async readTransfer(txHash: Hex): Promise<TransferRead> {
    if (this.down) throw new ChainUnavailableError('rpc down')
    return this.inner.readTransfer(txHash)
  }

  async recentTransferCandidates(limit: number): Promise<Hex[]> {
    if (this.down) throw new ChainUnavailableError('rpc down')
    return this.inner.recentTransferCandidates(limit)
  }
}

/** Mock rail whose broadcast fails a set number of times before succeeding. */
export class FlakyRail extends MockPaymentRail implements PaymentRail {
  broadcasts = 0
  signs = 0

  constructor(private failuresLeft: number) {
    super()
  }

  override async sign(call: RailCall) {
    this.signs++
    return super.sign(call)
  }

  override async broadcast(): Promise<void> {
    this.broadcasts++
    if (this.failuresLeft > 0) {
      this.failuresLeft--
      throw new PaymentRailError('simulated rpc timeout')
    }
  }
}

export interface TestApp extends App {
  clock: ManualClock
}

const TABLES = [
  'finding_events',
  'findings',
  'workflow_runs',
  'repos',
  'receipts',
  'payments',
  'task_events',
  'attempts',
  'tasks',
  'agent_runs',
  'agent_ticks',
  'leases',
]

let shared: Promise<Store> | undefined

/**
 * One in-memory Postgres per test file (vitest runs each file in its own
 * process), emptied before every test. TRUNCATE bypasses the append-only
 * row triggers, which is exactly what a reset needs.
 */
export async function freshStore(): Promise<Store> {
  shared ??= Store.open(':memory:')
  const store = await shared
  await store.database.exec(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`)
  return store
}

export async function makeApp(
  options: {
    env?: Record<string, string>
    chain?: ChainReader
    rail?: PaymentRail
    identity?: IdentityVerifier
    github?: GitHubClient | null
  } = {},
): Promise<TestApp> {
  const clock = new ManualClock(T0)
  const config = loadConfig({ ...TEST_ENV, ...options.env })
  const app = createApp(config, await freshStore(), {
    chain: options.chain ?? new FixtureChainReader('https://testnet.arcscan.app'),
    rail: options.rail ?? new MockPaymentRail(),
    identity: options.identity,
    github: options.github ?? null,
    clock,
  })
  return { ...app, clock }
}

/** Creates, funds and publishes a task for a fixture transaction. */
export async function openTask(app: App, txHash: Hex = FIXTURE.hash) {
  const draft = await app.tasks.createTask(txHash, 'test')
  await app.tasks.fundTask(draft.id, 'test')
  return app.tasks.publishTask(draft.id, 'test')
}

export async function claimAndSubmit(app: App, taskId: string, worker: Address, answer: { recipient: string; amount: string }) {
  const claim = await app.tasks.claimTask(taskId, worker)
  await app.tasks.submitTask(taskId, { claimId: claim.claimId, claimToken: claim.claimToken, ...answer })
  return claim
}

/** An operator: sees and decides on every team's repositories. */
export const OPERATOR: Viewer = { actor: 'owner', operator: true, teams: new Map() }
