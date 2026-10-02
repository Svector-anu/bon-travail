import { randomBytes } from 'node:crypto'
import { shortAddress } from '@/domain/address'
import { formatUsdc } from '@/domain/money'
import type { AgentRunSource, Hex, TaskRecord } from '@/domain/types'
import type { AgentStatusView, TickActionView, TickReport } from '@/domain/views'
import type { ChainReader } from '../chain/chain-reader'
import type { Clock } from '../clock'
import { DomainError } from '../errors'
import { errorMessage } from '../payments/ledger-provider'
import type { PaymentProvider } from '../payments/payment-provider'
import { StaleStateError, type Store } from '../store/store'
import type { TaskService } from './task-service'
import { displayId } from './views'

export interface AgentSettings {
  targetOpenTasks: number
  expectedIntervalMs: number
  chainReaderLabel: string
  publicBaseUrl: string
}

type Logger = (
  action: string,
  taskId: string | null,
  result: TickActionView['result'],
  detail: string,
  error?: string | null,
) => void

const TICK_LEASE = 'agent-tick'
const TICK_LEASE_TTL_MS = 2 * 60 * 1000
const CANDIDATE_SCAN = 12
const ACTIVE_STATES = ['OPEN', 'CLAIMED', 'SUBMITTED', 'VERIFYING', 'ACCEPTED', 'REJECTED'] as const

/** Skip quietly: another writer already moved the task, which is the outcome we wanted. */
function isBenign(error: unknown): boolean {
  return error instanceof StaleStateError || (error instanceof DomainError && error.code === 'CONFLICT')
}

/**
 * The autonomous operator. One tick is a deterministic sweep over every task
 * that needs attention, followed by keeping the open-task supply topped up.
 * Each action is logged as an AgentRun so the loop is visible and auditable.
 * Money decisions are never made by a model: Aeon (or the local loop) only
 * decides *when* to tick; this code decides *what* happens.
 */
export class Agent {
  constructor(
    private readonly store: Store,
    private readonly tasks: TaskService,
    private readonly chain: ChainReader,
    private readonly payments: PaymentProvider,
    private readonly clock: Clock,
    private readonly settings: AgentSettings,
  ) {}

  async tick(source: AgentRunSource): Promise<TickReport> {
    const startedAt = this.clock.now()
    const tickId = `tick_${randomBytes(6).toString('hex')}`
    if (!this.store.acquireLease(TICK_LEASE, tickId, startedAt, TICK_LEASE_TTL_MS)) {
      return {
        tickId: null,
        source,
        status: 'skipped',
        startedAt,
        finishedAt: startedAt,
        actions: [],
        openTasks: this.openTaskIds(),
        notable: [],
      }
    }

    this.store.insertTick({ id: tickId, source, startedAt, finishedAt: null, status: 'running', summary: null })
    const actions: TickActionView[] = []
    const notable: string[] = []
    const log = this.logger(tickId, source, actions)

    try {
      await this.sweep(log, notable)
      await this.ensureSupply(log, notable)
    } catch (error) {
      log('tick', null, 'error', 'tick aborted', errorMessage(error))
    } finally {
      this.store.releaseLease(TICK_LEASE, tickId)
    }

    const errors = actions.filter((a) => a.result === 'error')
    for (const e of errors) notable.push(`Agent error on ${e.taskId ?? 'tick'}: ${e.action} failed (${e.error})`)
    const finishedAt = this.clock.now()
    const status = errors.length > 0 ? 'error' : 'ok'
    const done = actions.filter((a) => a.result === 'ok').length
    const summary = `${done} action${done === 1 ? '' : 's'}, ${errors.length} error${errors.length === 1 ? '' : 's'}`
    this.store.finishTick(tickId, status, summary, finishedAt)

    return { tickId, source, status, startedAt, finishedAt, actions, openTasks: this.openTaskIds(), notable }
  }

  /**
   * Called right after a worker submits so they see a verdict in seconds
   * instead of waiting for the next scheduled tick. Same code path the tick
   * uses; the tick remains the recovery path if this fails.
   */
  async onSubmission(taskId: string): Promise<void> {
    const actions: TickActionView[] = []
    const log = this.logger(null, 'worker-event', actions)
    await this.settle(this.store.requireTask(taskId), log, [])
  }

  status(): AgentStatusView {
    const now = this.clock.now()
    const ticks = this.store.listTicks(200)
    const last = ticks[0] ?? null
    const lastSuccess = ticks.find((t) => t.status === 'ok') ?? null
    const lastAt = last ? (last.finishedAt ?? last.startedAt) : null
    let health: AgentStatusView['health'] = 'never'
    if (this.store.currentLease(TICK_LEASE, now)) health = 'running'
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
    return (action, taskId, result, detail, error = null) => {
      actions.push({ action, taskId, result, detail, error })
      this.store.insertRun({
        id: `run_${randomBytes(8).toString('hex')}`,
        tickId,
        source,
        action,
        taskId,
        at: this.clock.now(),
        result,
        detail,
        error,
      })
    }
  }

  private async sweep(log: Logger, notable: string[]): Promise<void> {
    const now = this.clock.now()
    const tasks = this.store.listTasks({ states: [...ACTIVE_STATES, 'DRAFT', 'FUNDED', 'EXPIRED'], limit: 500 })
    for (const task of tasks.reverse()) {
      try {
        if (task.state === 'DRAFT' || task.state === 'FUNDED') {
          await this.publish(task, log, notable)
        } else if (task.state === 'CLAIMED' && task.claimExpiresAt !== null && task.claimExpiresAt <= now) {
          const next = this.tasks.releaseLapsedClaim(task.id, 'agent')
          log('release_lapsed_claim', task.id, 'ok', `Claim by ${shortAddress(task.claimant ?? '')} lapsed; task is ${next.state}`)
          if (next.state === 'EXPIRED') await this.refund(next, log, notable)
        } else if (task.state === 'OPEN' && now >= task.deadlineAt) {
          this.tasks.expireTask(task.id, 'agent')
          log('expire', task.id, 'ok', `${displayId(task)} passed its deadline`)
          await this.refund(this.store.requireTask(task.id), log, notable)
        } else if (task.state === 'EXPIRED') {
          await this.refund(task, log, notable)
        } else if (task.state === 'REJECTED') {
          await this.reopen(task, log, notable)
        } else if (task.state === 'SUBMITTED' || task.state === 'VERIFYING' || task.state === 'ACCEPTED') {
          await this.settle(task, log, notable)
        }
      } catch (error) {
        if (isBenign(error)) log('sweep', task.id, 'skipped', errorMessage(error))
        else log('sweep', task.id, 'error', `Could not advance ${displayId(task)} from ${task.state}`, errorMessage(error))
      }
    }
  }

  /** Verify then pay. Each step is idempotent, so re-entry after a crash is safe. */
  private async settle(task: TaskRecord, log: Logger, notable: string[]): Promise<void> {
    let current = task
    if (current.state === 'SUBMITTED' || current.state === 'VERIFYING') {
      try {
        current = await this.tasks.verifySubmission(current.id, 'agent:verifier')
      } catch (error) {
        if (isBenign(error)) return log('verify', task.id, 'skipped', errorMessage(error))
        return log('verify', task.id, 'error', `Verification of ${displayId(task)} will be retried`, errorMessage(error))
      }
      const verdict = this.store.listAttempts(task.id).find((a) => a.claimId === task.claimId)?.verification
      if (current.state === 'ACCEPTED') {
        log('verify', task.id, 'ok', `RPC verification passed: ${verdict?.reason ?? 'match'}`)
      } else {
        log('verify', task.id, 'ok', `Submission rejected: ${verdict?.reason ?? 'mismatch'}`)
        notable.push(`${displayId(task)}: submission from ${shortAddress(task.claimant ?? '')} rejected (${verdict?.code ?? 'MISMATCH'})`)
        return this.reopen(current, log, notable)
      }
    }
    if (current.state !== 'ACCEPTED') return

    try {
      const paid = await this.tasks.releasePayment(current.id, 'agent:payer')
      if (paid.state === 'PAID') {
        const payout = this.store.getPayment(paid.id, 'release')
        const amount = formatUsdc(paid.rewardMicro)
        log('pay', paid.id, 'ok', `${amount} USDC paid to ${shortAddress(paid.claimant ?? '')}${this.payments.simulated ? ' (simulated)' : ''}`)
        notable.push(
          `${displayId(paid)} paid ${amount} USDC to ${paid.claimant}${this.payments.simulated ? ' (simulated)' : ''}. tx ${payout?.txHash ?? 'n/a'}. Receipt ${this.receiptUrl(paid.id)}`,
        )
      } else {
        log('pay', paid.id, 'skipped', 'Payout broadcast, waiting for confirmation')
      }
    } catch (error) {
      if (isBenign(error)) return log('pay', task.id, 'skipped', errorMessage(error))
      log('pay', task.id, 'error', `Payout for ${displayId(task)} will be retried`, errorMessage(error))
    }
  }

  private async reopen(task: TaskRecord, log: Logger, notable: string[]): Promise<void> {
    const next = this.tasks.reopenTask(task.id, 'agent')
    if (next.state === 'OPEN') {
      log('reopen', task.id, 'ok', `${displayId(task)} reopened after a rejected submission`)
      return
    }
    log('expire', task.id, 'ok', `${displayId(task)} expired after a rejected submission`)
    await this.refund(next, log, notable)
  }

  private async refund(task: TaskRecord, log: Logger, notable: string[]): Promise<void> {
    const refunded = await this.tasks.refundTask(task.id, 'agent')
    if (refunded.state !== 'REFUNDED') {
      log('refund', task.id, 'skipped', 'Refund broadcast, waiting for confirmation')
      return
    }
    log('refund', task.id, 'ok', `${formatUsdc(refunded.rewardMicro)} USDC reward returned to the agent treasury`)
    notable.push(`${displayId(task)} expired with no accepted submission; reward refunded. Receipt ${this.receiptUrl(task.id)}`)
  }

  private async publish(task: TaskRecord, log: Logger, notable: string[]): Promise<void> {
    if (task.state === 'DRAFT') {
      const funded = await this.tasks.fundTask(task.id, 'agent')
      if (funded.state !== 'FUNDED') {
        log('fund', task.id, 'skipped', `Funding for ${displayId(task)} broadcast, waiting for confirmation`)
        return
      }
      log('fund', task.id, 'ok', `${this.payments.simulated ? 'Reserved' : 'Escrowed'} ${formatUsdc(task.rewardMicro)} USDC for ${displayId(task)}`)
    }
    this.tasks.publishTask(task.id, 'agent')
    log('publish', task.id, 'ok', `${displayId(task)} is open: ${task.title}`)
    notable.push(`New task ${displayId(task)}: ${task.title}, reward ${formatUsdc(task.rewardMicro)} USDC. ${this.settings.publicBaseUrl}/task/${task.id}`)
  }

  private async ensureSupply(log: Logger, notable: string[]): Promise<void> {
    const open = this.store.listTasks({ states: ['OPEN', 'CLAIMED', 'SUBMITTED', 'VERIFYING', 'REJECTED'] }).length
    let missing = this.settings.targetOpenTasks - open
    if (missing <= 0) return

    let candidates: Hex[]
    try {
      candidates = await this.chain.recentTransferCandidates(CANDIDATE_SCAN)
    } catch (error) {
      log('source_task', null, 'error', 'Could not scan the chain for a new transaction', errorMessage(error))
      return
    }

    for (const hash of candidates) {
      if (missing <= 0) break
      if (this.store.hasTaskForTx(hash)) continue
      let task: TaskRecord
      try {
        task = await this.tasks.createTask(hash, 'agent')
      } catch (error) {
        if (error instanceof DomainError) continue
        log('create_task', null, 'error', `Could not create a task from ${shortAddress(hash)}`, errorMessage(error))
        return
      }
      log('create_task', task.id, 'ok', `Created ${displayId(task)} from ${this.settings.chainReaderLabel} tx ${shortAddress(hash)}`)
      try {
        await this.publish(task, log, notable)
      } catch (error) {
        log('fund', task.id, 'error', `${displayId(task)} created but not funded; will retry`, errorMessage(error))
        return
      }
      missing--
    }
    if (missing > 0) log('source_task', null, 'skipped', 'No unused eligible transaction found this tick')
  }

  private openTaskIds(): string[] {
    return this.store.listTasks({ states: ['OPEN'] }).map((t) => t.id)
  }

  private receiptUrl(taskId: string): string {
    return `${this.settings.publicBaseUrl}/receipt/${taskId}`
  }
}

