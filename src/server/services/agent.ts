import { randomBytes } from 'node:crypto'
import { shortAddress } from '@/domain/address'
import { formatUsdc } from '@/domain/money'
import { TASK_KIND_CI_FIX, type AgentRunSource, type Hex, type TaskRecord } from '@/domain/types'
import type { AgentStatusView, TickActionView, TickReport } from '@/domain/views'
import type { ChainReader } from '../chain/chain-reader'
import type { Clock } from '../clock'
import { DomainError } from '../errors'
import { errorMessage } from '../payments/ledger-provider'
import type { PaymentProvider } from '../payments/payment-provider'
import { StaleStateError, type Store } from '../store/store'
import type { WatchStore } from '../store/watch-store'
import { VerificationPendingError } from '../verification/verifier'
import type { TaskService } from './task-service'
import { displayId } from './views'
import type { WorkService } from './work-service'

export interface AgentSettings {
  targetOpenTasks: number
  expectedIntervalMs: number
  observeIntervalMs: number
  chainReaderLabel: string
  publicBaseUrl: string
}

type Logger = (
  action: string,
  taskId: string | null,
  result: TickActionView['result'],
  detail: string,
  error?: string | null,
  findingId?: string | null,
) => Promise<void>

const TICK_LEASE = 'agent-tick'
const TICK_LEASE_TTL_MS = 2 * 60 * 1000
const CANDIDATE_SCAN = 12
const ACTIVE_STATES = ['OPEN', 'CLAIMED', 'SUBMITTED', 'VERIFYING', 'ACCEPTED', 'REJECTED'] as const

/** Skip quietly: another writer already moved the task, which is the outcome we wanted. */
function isBenign(error: unknown): boolean {
  return error instanceof StaleStateError || (error instanceof DomainError && error.code === 'CONFLICT')
}

/**
 * The autonomous operator. One tick observes the watched repositories, then
 * sweeps every task that needs attention. Each action is logged as an
 * AgentRun so the loop is visible and auditable. Money decisions are never
 * made by a model: Aeon only decides *when* to tick; this code decides
 * *what* happens, and it can only pay what an engineer already approved.
 */
export class Agent {
  constructor(
    private readonly store: Store,
    private readonly watch: WatchStore,
    private readonly tasks: TaskService,
    private readonly work: WorkService,
    private readonly chain: ChainReader,
    private readonly payments: PaymentProvider,
    private readonly clock: Clock,
    private readonly settings: AgentSettings,
    private readonly githubEnabled: boolean,
  ) {}

  async tick(source: AgentRunSource): Promise<TickReport> {
    const startedAt = this.clock.now()
    const tickId = `tick_${randomBytes(6).toString('hex')}`
    if (!(await this.store.acquireLease(TICK_LEASE, tickId, startedAt, TICK_LEASE_TTL_MS))) {
      return {
        tickId: null,
        source,
        status: 'skipped',
        startedAt,
        finishedAt: startedAt,
        actions: [],
        openTasks: await this.openTaskIds(),
        notable: [],
      }
    }

    await this.store.insertTick({ id: tickId, source, startedAt, finishedAt: null, status: 'running', summary: null })
    const actions: TickActionView[] = []
    const notable: string[] = []
    const log = this.logger(tickId, source, actions)

    try {
      await this.observe(log, notable)
      await this.sweep(log, notable)
      await this.ensureSupply(log, notable)
    } catch (error) {
      await log('tick', null, 'error', 'tick aborted', errorMessage(error))
    } finally {
      await this.store.releaseLease(TICK_LEASE, tickId)
    }

    const errors = actions.filter((a) => a.result === 'error')
    for (const e of errors) notable.push(`Agent error on ${e.taskId ?? e.findingId ?? 'tick'}: ${e.action} failed (${e.error})`)
    const finishedAt = this.clock.now()
    const status = errors.length > 0 ? 'error' : 'ok'
    const done = actions.filter((a) => a.result === 'ok').length
    const summary = `${done} action${done === 1 ? '' : 's'}, ${errors.length} error${errors.length === 1 ? '' : 's'}`
    await this.store.finishTick(tickId, status, summary, finishedAt)

    return { tickId, source, status, startedAt, finishedAt, actions, openTasks: await this.openTaskIds(), notable }
  }

  /**
   * Called right after a submission so the submitter sees a verdict (or
   * "waiting on checks") in the same request. Same code path as the tick;
   * the tick remains the recovery path.
   */
  async onSubmission(taskId: string): Promise<void> {
    const actions: TickActionView[] = []
    const log = this.logger(null, 'worker-event', actions)
    await this.settle(await this.store.requireTask(taskId), log, [])
  }

  async status(): Promise<AgentStatusView> {
    const now = this.clock.now()
    const ticks = await this.store.listTicks(200)
    const last = ticks[0] ?? null
    const lastSuccess = ticks.find((t) => t.status === 'ok') ?? null
    const lastAt = last ? (last.finishedAt ?? last.startedAt) : null
    let health: AgentStatusView['health'] = 'never'
    if (await this.store.currentLease(TICK_LEASE, now)) health = 'running'
    else if (!last) health = 'never'
    else if (lastAt !== null && now - lastAt > this.settings.expectedIntervalMs * 2) health = 'stale'
    else if (last.status === 'error') health = 'error'
    else health = 'alive'

    return {
      health,
      lastTickAt: lastAt,
      lastTickSource: last?.source ?? null,
      lastTickSummary: last?.summary ?? null,
      lastSuccessAt: lastSuccess ? (lastSuccess.finishedAt ?? lastSuccess.startedAt) : null,
      expectedIntervalMs: this.settings.expectedIntervalMs,
      nextExpectedAt: lastAt !== null ? lastAt + this.settings.expectedIntervalMs : null,
      ticksLast24h: ticks.filter((t) => t.startedAt > now - 24 * 60 * 60 * 1000).length,
      paymentProvider: this.payments.name,
      simulatedPayments: this.payments.simulated,
      chainReader: this.settings.chainReaderLabel,
    }
  }

  // ---- internals -----------------------------------------------------------

  private logger(tickId: string | null, source: AgentRunSource, actions: TickActionView[]): Logger {
    return async (action, taskId, result, detail, error = null, findingId = null) => {
      actions.push({ action, taskId, findingId, result, detail, error })
      await this.store.insertRun({
        id: `run_${randomBytes(8).toString('hex')}`,
        tickId,
        source,
        action,
        taskId,
        findingId,
        at: this.clock.now(),
        result,
        detail,
        error,
      })
    }
  }

  private async observe(log: Logger, notable: string[]): Promise<void> {
    if (!this.githubEnabled) return
    const now = this.clock.now()
    for (const repo of await this.watch.listRepos(true)) {
      if (repo.lastPolledAt !== null && now - repo.lastPolledAt < this.settings.observeIntervalMs) continue
      try {
        const report = await this.work.observe(repo, 'agent:observer')
        notable.push(...report.notable)
        const slug = `${repo.owner}/${repo.name}`
        for (const id of report.detected) await log('detect', null, 'ok', `New failure on ${slug} is being watched`, null, id)
        for (const id of report.repeated) await log('repeat', null, 'ok', `Failure repeated on ${slug}; evidence gathered for review`, null, id)
        for (const id of report.resolved) await log('resolve', null, 'ok', `${slug} is green again; finding resolved`, null, id)
        for (const id of report.recurred) await log('recur', null, 'ok', `A fixed failure came back on ${slug}`, null, id)
        if (report.newRuns > 0 && report.detected.length + report.repeated.length + report.resolved.length + report.recurred.length === 0) {
          await log('observe', null, 'ok', `${report.newRuns} new run${report.newRuns === 1 ? '' : 's'} on ${slug}, nothing new failing`)
        }
      } catch (error) {
        await log('observe', null, 'error', `Could not read ${repo.owner}/${repo.name} from GitHub`, errorMessage(error))
      }
    }
  }

  private async sweep(log: Logger, notable: string[]): Promise<void> {
    const now = this.clock.now()
    const tasks = await this.store.listTasks({ states: [...ACTIVE_STATES, 'DRAFT', 'FUNDED', 'EXPIRED'], limit: 500 })
    for (const task of tasks.reverse()) {
      try {
        if (task.state === 'DRAFT' || task.state === 'FUNDED') {
          await this.publish(task, log, notable)
        } else if (task.state === 'CLAIMED' && task.claimExpiresAt !== null && task.claimExpiresAt <= now) {
          const next = await this.tasks.releaseLapsedClaim(task.id, 'agent')
          await log('release_lapsed_claim', task.id, 'ok', `Claim by ${this.who(task)} lapsed; task is ${next.state}`)
          if (next.state === 'EXPIRED') await this.refund(next, log, notable)
        } else if (task.state === 'OPEN' && now >= task.deadlineAt) {
          await this.tasks.expireTask(task.id, 'agent')
          await log('expire', task.id, 'ok', `${displayId(task)} passed its deadline`)
          await this.refund(await this.store.requireTask(task.id), log, notable)
        } else if (task.state === 'EXPIRED') {
          await this.refund(task, log, notable)
        } else if (task.state === 'REJECTED') {
          await this.reopen(task, log, notable)
        } else if (task.state === 'SUBMITTED' || task.state === 'VERIFYING' || task.state === 'ACCEPTED') {
          await this.settle(task, log, notable)
        }
      } catch (error) {
        if (isBenign(error)) await log('sweep', task.id, 'skipped', errorMessage(error))
        else await log('sweep', task.id, 'error', `Could not advance ${displayId(task)} from ${task.state}`, errorMessage(error))
      }
    }
  }

  private who(task: TaskRecord): string {
    return task.claimantHandle ? `@${task.claimantHandle}` : shortAddress(task.claimant ?? '')
  }

  /** Verify then pay. Each step is idempotent, so re-entry after a crash is safe. */
  private async settle(task: TaskRecord, log: Logger, notable: string[]): Promise<void> {
    let current = task
    const ci = task.kind === TASK_KIND_CI_FIX
    if (current.state === 'SUBMITTED' || current.state === 'VERIFYING') {
      try {
        current = await this.tasks.verifySubmission(current.id, 'agent:verifier')
      } catch (error) {
        if (error instanceof VerificationPendingError) return log('verify', task.id, 'skipped', `Waiting: ${error.message}`)
        if (isBenign(error)) return log('verify', task.id, 'skipped', errorMessage(error))
        return log('verify', task.id, 'error', `Verification of ${displayId(task)} will be retried`, errorMessage(error))
      }
      const verdict = (await this.store.listAttempts(task.id)).find((a) => a.claimId === task.claimId)?.verification
      if (current.state === 'ACCEPTED') {
        await log('verify', task.id, 'ok', `${ci ? 'GitHub Actions' : 'RPC'} verification passed: ${verdict?.reason ?? 'match'}`)
      } else {
        await log('verify', task.id, 'ok', `Submission rejected: ${verdict?.reason ?? 'mismatch'}`)
        notable.push(`${displayId(task)}: submission from ${this.who(task)} rejected (${verdict?.code ?? 'MISMATCH'})`)
        return this.reopen(current, log, notable)
      }
    }
    if (current.state !== 'ACCEPTED') return

    try {
      const paid = await this.tasks.releasePayment(current.id, 'agent:payer')
      if (paid.state === 'PAID') {
        const payout = await this.store.getPayment(paid.id, 'release')
        const amount = formatUsdc(paid.rewardMicro)
        const simulated = this.payments.simulated ? ' (simulated)' : ''
        await log('pay', paid.id, 'ok', `${amount} USDC paid to ${this.who(paid)}${simulated}`)
        notable.push(
          `${displayId(paid)} paid ${amount} USDC to ${this.who(paid)} at ${paid.claimant}${simulated}. tx ${payout?.txHash ?? 'n/a'}. Receipt ${this.receiptUrl(paid.id)}`,
        )
      } else {
        await log('pay', paid.id, 'skipped', 'Payout broadcast, waiting for confirmation')
      }
    } catch (error) {
      if (isBenign(error)) return log('pay', task.id, 'skipped', errorMessage(error))
      await log('pay', task.id, 'error', `Payout for ${displayId(task)} will be retried`, errorMessage(error))
    }
  }

  private async reopen(task: TaskRecord, log: Logger, notable: string[]): Promise<void> {
    const next = await this.tasks.reopenTask(task.id, 'agent')
    if (next.state === 'OPEN') {
      await log('reopen', task.id, 'ok', `${displayId(task)} reopened after a rejected submission`)
      return
    }
    await log('expire', task.id, 'ok', `${displayId(task)} expired after a rejected submission`)
    await this.refund(next, log, notable)
  }

  private async refund(task: TaskRecord, log: Logger, notable: string[]): Promise<void> {
    const refunded = await this.tasks.refundTask(task.id, 'agent')
    if (refunded.state !== 'REFUNDED') {
      await log('refund', task.id, 'skipped', 'Refund broadcast, waiting for confirmation')
      return
    }
    await log('refund', task.id, 'ok', `${formatUsdc(refunded.rewardMicro)} USDC reward returned to the treasury`)
    notable.push(`${displayId(task)} expired with no accepted submission; reward refunded. Receipt ${this.receiptUrl(task.id)}`)
  }

  private async publish(task: TaskRecord, log: Logger, notable: string[]): Promise<void> {
    if (task.state === 'DRAFT') {
      const funded = await this.tasks.fundTask(task.id, 'agent')
      if (funded.state !== 'FUNDED') {
        await log('fund', task.id, 'skipped', `Funding for ${displayId(task)} broadcast, waiting for confirmation`)
        return
      }
      await log('fund', task.id, 'ok', `${this.payments.simulated ? 'Reserved' : 'Escrowed'} ${formatUsdc(task.rewardMicro)} USDC for ${displayId(task)}`)
    }
    await this.tasks.publishTask(task.id, 'agent')
    await log('publish', task.id, 'ok', `${displayId(task)} is open: ${task.title}`)
    notable.push(`New ${task.kind === TASK_KIND_CI_FIX ? 'work package' : 'task'} ${displayId(task)}: ${task.title}, reward ${formatUsdc(task.rewardMicro)} USDC. ${this.settings.publicBaseUrl}/task/${task.id}`)
  }

  /** Rail tests only. Work packages are never created by the agent; an engineer approves each one. */
  private async ensureSupply(log: Logger, notable: string[]): Promise<void> {
    if (this.settings.targetOpenTasks <= 0) return
    const open = (
      await this.store.listTasks({ states: ['OPEN', 'CLAIMED', 'SUBMITTED', 'VERIFYING', 'REJECTED'], kinds: ['tx-fact-check'] })
    ).length
    let missing = this.settings.targetOpenTasks - open
    if (missing <= 0) return

    let candidates: Hex[]
    try {
      candidates = await this.chain.recentTransferCandidates(CANDIDATE_SCAN)
    } catch (error) {
      await log('source_task', null, 'error', 'Could not scan the chain for a new transaction', errorMessage(error))
      return
    }

    for (const hash of candidates) {
      if (missing <= 0) break
      if (await this.store.hasTaskForSubject(hash)) continue
      let task: TaskRecord
      try {
        task = await this.tasks.createTask(hash, 'agent')
      } catch (error) {
        if (error instanceof DomainError) continue
        await log('create_task', null, 'error', `Could not create a task from ${shortAddress(hash)}`, errorMessage(error))
        return
      }
      await log('create_task', task.id, 'ok', `Created ${displayId(task)} from ${this.settings.chainReaderLabel} tx ${shortAddress(hash)}`)
      try {
        await this.publish(task, log, notable)
      } catch (error) {
        await log('fund', task.id, 'error', `${displayId(task)} created but not funded; will retry`, errorMessage(error))
        return
      }
      missing--
    }
    if (missing > 0) await log('source_task', null, 'skipped', 'No unused eligible transaction found this tick')
  }

  private async openTaskIds(): Promise<string[]> {
    return (await this.store.listTasks({ states: ['OPEN'] })).map((t) => t.id)
  }

  private receiptUrl(taskId: string): string {
    return `${this.settings.publicBaseUrl}/receipt/${taskId}`
  }
}
