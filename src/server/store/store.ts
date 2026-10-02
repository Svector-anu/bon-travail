import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { assertTransition, type TaskState } from '@/domain/task-state'
import type {
  Address,
  AgentRunRecord,
  AgentTickRecord,
  AttemptOutcome,
  AttemptRecord,
  Hex,
  PaymentKind,
  PaymentRecord,
  PaymentStatus,
  Submission,
  TaskEvent,
  TaskEventType,
  TaskRecord,
  TransferFact,
  VerificationResult,
} from '@/domain/types'
import { fromJson, num, optNum, optStr, str, toJson } from './codec'
import { COLUMN_MIGRATIONS, POST_MIGRATION_SQL, SCHEMA } from './schema'

type Row = Record<string, unknown>

/** The task was not in the state the caller expected; someone else moved it first. */
export class StaleStateError extends Error {
  constructor(
    readonly taskId: string,
    readonly expected: readonly TaskState[],
    readonly actual: TaskState,
  ) {
    super(`${taskId} is ${actual}, expected ${expected.join(' or ')}`)
    this.name = 'StaleStateError'
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = 'NotFoundError'
  }
}

type TaskPatch = Partial<
  Pick<
    TaskRecord,
    | 'claimant'
    | 'claimId'
    | 'claimExpiresAt'
    | 'fundedAt'
    | 'openedAt'
    | 'claimedAt'
    | 'submittedAt'
    | 'settledAt'
  >
>

const PATCH_COLUMNS: Record<keyof TaskPatch, string> = {
  claimant: 'claimant',
  claimId: 'claim_id',
  claimExpiresAt: 'claim_expires_at',
  fundedAt: 'funded_at',
  openedAt: 'opened_at',
  claimedAt: 'claimed_at',
  submittedAt: 'submitted_at',
  settledAt: 'settled_at',
}

export interface TransitionInput {
  taskId: string
  from: TaskState | readonly TaskState[]
  to: TaskState
  at: number
  actor: string
  event: TaskEventType
  detail?: Record<string, unknown>
  patch?: TaskPatch
}

function rowToTask(row: Row): TaskRecord {
  return {
    id: str(row, 'id'),
    seq: num(row, 'seq'),
    kind: str(row, 'kind') as TaskRecord['kind'],
    title: str(row, 'title'),
    description: str(row, 'description'),
    rewardMicro: BigInt(str(row, 'reward_micro')),
    currency: 'USDC',
    chain: str(row, 'chain'),
    txHash: str(row, 'tx_hash') as Hex,
    expected: fromJson<TransferFact>(str(row, 'expected_json')),
    deadlineAt: num(row, 'deadline_at'),
    state: str(row, 'state') as TaskState,
    claimant: optStr(row, 'claimant') as Address | null,
    claimId: optStr(row, 'claim_id'),
    claimExpiresAt: optNum(row, 'claim_expires_at'),
    createdAt: num(row, 'created_at'),
    fundedAt: optNum(row, 'funded_at'),
    openedAt: optNum(row, 'opened_at'),
    claimedAt: optNum(row, 'claimed_at'),
    submittedAt: optNum(row, 'submitted_at'),
    settledAt: optNum(row, 'settled_at'),
    version: num(row, 'version'),
  }
}

function rowToAttempt(row: Row): AttemptRecord {
  const submission = optStr(row, 'submission_json')
  const verification = optStr(row, 'verification_json')
  return {
    id: str(row, 'id'),
    taskId: str(row, 'task_id'),
    claimId: str(row, 'claim_id'),
    worker: str(row, 'worker') as Address,
    claimedAt: num(row, 'claimed_at'),
    claimExpiresAt: num(row, 'claim_expires_at'),
    submittedAt: optNum(row, 'submitted_at'),
    submission: submission ? fromJson<Submission>(submission) : null,
    verification: verification ? fromJson<VerificationResult>(verification) : null,
    outcome: optStr(row, 'outcome') as AttemptOutcome | null,
  }
}

function rowToEvent(row: Row): TaskEvent {
  return {
    id: num(row, 'id'),
    taskId: str(row, 'task_id'),
    at: num(row, 'at'),
    type: str(row, 'type') as TaskEventType,
    fromState: optStr(row, 'from_state') as TaskState | null,
    toState: optStr(row, 'to_state') as TaskState | null,
    actor: str(row, 'actor'),
    detail: fromJson<Record<string, unknown>>(str(row, 'detail_json')),
  }
}

function rowToPayment(row: Row): PaymentRecord {
  return {
    id: str(row, 'id'),
    taskId: str(row, 'task_id'),
    kind: str(row, 'kind') as PaymentKind,
    idempotencyKey: str(row, 'idempotency_key'),
    provider: str(row, 'provider'),
    amountMicro: BigInt(str(row, 'amount_micro')),
    recipient: optStr(row, 'recipient') as Address | null,
    status: str(row, 'status') as PaymentStatus,
    txHash: optStr(row, 'tx_hash') as Hex | null,
    rawTx: optStr(row, 'raw_tx') as Hex | null,
    error: optStr(row, 'error'),
    createdAt: num(row, 'created_at'),
    updatedAt: num(row, 'updated_at'),
  }
}

function rowToRun(row: Row): AgentRunRecord {
  return {
    id: str(row, 'id'),
    tickId: optStr(row, 'tick_id'),
    source: str(row, 'source') as AgentRunRecord['source'],
    action: str(row, 'action'),
    taskId: optStr(row, 'task_id'),
    at: num(row, 'at'),
    result: str(row, 'result') as AgentRunRecord['result'],
    detail: str(row, 'detail'),
    error: optStr(row, 'error'),
  }
}

function rowToTick(row: Row): AgentTickRecord {
  return {
    id: str(row, 'id'),
    source: str(row, 'source') as AgentTickRecord['source'],
    startedAt: num(row, 'started_at'),
    finishedAt: optNum(row, 'finished_at'),
    status: str(row, 'status') as AgentTickRecord['status'],
    summary: optStr(row, 'summary'),
  }
}

export interface StoredReceipt {
  taskId: string
  outcome: string
  createdAt: number
  bodyJson: string
  digest: string
}

export class Store {
  private readonly db: DatabaseSync
  private inTransaction = false

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
    for (const migration of COLUMN_MIGRATIONS) {
      const columns = this.all(`PRAGMA table_info(${migration.table})`).map((row) => str(row, 'name'))
      if (!columns.includes(migration.column)) this.db.exec(migration.sql)
    }
    this.db.exec(POST_MIGRATION_SQL)
  }

  close(): void {
    this.db.close()
  }

  /**
   * Runs fn inside BEGIN IMMEDIATE so concurrent writers (the web server and
   * a local agent loop share the file) serialise instead of interleaving.
   */
  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.inTransaction = true
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.inTransaction = false
    }
  }

  private get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params)
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params)
  }

  private run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.db.prepare(sql).run(...params).changes)
  }

  // ---- tasks ---------------------------------------------------------------

  nextTaskSeq(): number {
    const row = this.get('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tasks')
    return row ? num(row, 'next') : 1
  }

  hasTaskForTx(txHash: Hex): boolean {
    return this.get('SELECT 1 FROM tasks WHERE lower(tx_hash) = lower(?)', txHash) !== undefined
  }

  insertTask(task: TaskRecord, actor: string): void {
    this.transaction(() => {
      this.run(
        `INSERT INTO tasks (id, seq, kind, title, description, reward_micro, currency, chain, tx_hash,
           expected_json, deadline_at, state, created_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        task.id,
        task.seq,
        task.kind,
        task.title,
        task.description,
        task.rewardMicro.toString(),
        task.currency,
        task.chain,
        task.txHash,
        toJson(task.expected),
        task.deadlineAt,
        task.state,
        task.createdAt,
      )
      this.appendEvent(task.id, task.createdAt, 'created', null, task.state, actor, {
        txHash: task.txHash,
        reward: task.rewardMicro,
      })
    })
  }

  getTask(id: string): TaskRecord | null {
    const row = this.get('SELECT * FROM tasks WHERE id = ?', id)
    return row ? rowToTask(row) : null
  }

  requireTask(id: string): TaskRecord {
    const task = this.getTask(id)
    if (!task) throw new NotFoundError(`task ${id}`)
    return task
  }

  listTasks(options: { states?: readonly TaskState[]; limit?: number } = {}): TaskRecord[] {
    const limit = options.limit ?? 100
    if (options.states && options.states.length > 0) {
      const marks = options.states.map(() => '?').join(', ')
      return this.all(
        `SELECT * FROM tasks WHERE state IN (${marks}) ORDER BY seq DESC LIMIT ?`,
        ...options.states,
        limit,
      ).map(rowToTask)
    }
    return this.all('SELECT * FROM tasks ORDER BY seq DESC LIMIT ?', limit).map(rowToTask)
  }

  /**
   * The only way a task changes state. Checks the current state and the
   * legal-transition table, bumps the version and appends the event, all in
   * one transaction. Throws StaleStateError if another writer got there first.
   */
  transition(input: TransitionInput): TaskRecord {
    return this.transaction(() => {
      const task = this.requireTask(input.taskId)
      const allowed: readonly TaskState[] = typeof input.from === 'string' ? [input.from] : input.from
      if (!allowed.includes(task.state)) throw new StaleStateError(task.id, allowed, task.state)
      assertTransition(task.id, task.state, input.to)

      const sets = ['state = ?', 'version = version + 1']
      const values: SQLInputValue[] = [input.to]
      for (const [key, value] of Object.entries(input.patch ?? {}) as [keyof TaskPatch, TaskPatch[keyof TaskPatch]][]) {
        sets.push(`${PATCH_COLUMNS[key]} = ?`)
        values.push(value ?? null)
      }
      const changed = this.run(
        `UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND version = ?`,
        ...values,
        task.id,
        task.version,
      )
      if (changed !== 1) throw new StaleStateError(task.id, allowed, task.state)

      this.appendEvent(task.id, input.at, input.event, task.state, input.to, input.actor, input.detail ?? {})
      return this.requireTask(task.id)
    })
  }

  // ---- events --------------------------------------------------------------

  appendEvent(
    taskId: string,
    at: number,
    type: TaskEventType,
    fromState: TaskState | null,
    toState: TaskState | null,
    actor: string,
    detail: Record<string, unknown>,
  ): void {
    this.run(
      'INSERT INTO task_events (task_id, at, type, from_state, to_state, actor, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      taskId,
      at,
      type,
      fromState,
      toState,
      actor,
      toJson(detail),
    )
  }

  listEvents(taskId: string): TaskEvent[] {
    return this.all('SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC', taskId).map(rowToEvent)
  }

  // ---- attempts ------------------------------------------------------------

  insertAttempt(attempt: AttemptRecord, claimTokenHash: string, identity: string | null): void {
    this.run(
      `INSERT INTO attempts (id, task_id, claim_id, claim_token_hash, worker, identity, claimed_at, claim_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      attempt.id,
      attempt.taskId,
      attempt.claimId,
      claimTokenHash,
      attempt.worker,
      identity,
      attempt.claimedAt,
      attempt.claimExpiresAt,
    )
  }

  getAttemptByClaim(claimId: string): { attempt: AttemptRecord; claimTokenHash: string } | null {
    const row = this.get('SELECT * FROM attempts WHERE claim_id = ?', claimId)
    return row ? { attempt: rowToAttempt(row), claimTokenHash: str(row, 'claim_token_hash') } : null
  }

  listAttempts(taskId: string): AttemptRecord[] {
    return this.all('SELECT * FROM attempts WHERE task_id = ? ORDER BY claimed_at ASC', taskId).map(rowToAttempt)
  }

  workerHasSubmitted(taskId: string, worker: Address): boolean {
    return (
      this.get('SELECT 1 FROM attempts WHERE task_id = ? AND worker = ? AND submitted_at IS NOT NULL', taskId, worker) !==
      undefined
    )
  }

  listAttemptsByWorker(worker: Address, limit = 50): AttemptRecord[] {
    return this.all('SELECT * FROM attempts WHERE worker = ? ORDER BY claimed_at DESC LIMIT ?', worker, limit).map(rowToAttempt)
  }

  identityHasSubmitted(taskId: string, identity: string): boolean {
    return (
      this.get('SELECT 1 FROM attempts WHERE task_id = ? AND identity = ? AND submitted_at IS NOT NULL', taskId, identity) !==
      undefined
    )
  }

  recordSubmission(claimId: string, submission: Submission, at: number): void {
    const changed = this.run(
      'UPDATE attempts SET submission_json = ?, submitted_at = ? WHERE claim_id = ? AND submitted_at IS NULL',
      toJson(submission),
      at,
      claimId,
    )
    if (changed !== 1) throw new Error(`claim ${claimId} already has a submission`)
  }

  /** Verification verdicts are written once and never overwritten. */
  recordVerdict(claimId: string, verification: VerificationResult, outcome: AttemptOutcome): void {
    const changed = this.run(
      'UPDATE attempts SET verification_json = ?, outcome = ? WHERE claim_id = ? AND outcome IS NULL',
      toJson(verification),
      outcome,
      claimId,
    )
    if (changed !== 1) throw new Error(`claim ${claimId} already has a verdict`)
  }

  markAttemptLapsed(claimId: string): void {
    this.run("UPDATE attempts SET outcome = 'LAPSED' WHERE claim_id = ? AND outcome IS NULL AND submitted_at IS NULL", claimId)
  }

  // ---- payments ------------------------------------------------------------

  getPayment(taskId: string, kind: PaymentKind): PaymentRecord | null {
    const row = this.get('SELECT * FROM payments WHERE task_id = ? AND kind = ?', taskId, kind)
    return row ? rowToPayment(row) : null
  }

  listPayments(taskId: string): PaymentRecord[] {
    return this.all('SELECT * FROM payments WHERE task_id = ? ORDER BY created_at ASC', taskId).map(rowToPayment)
  }

  /** Inserts the payment intent; returns the existing row if one already exists. */
  ensurePayment(payment: PaymentRecord): PaymentRecord {
    return this.transaction(() => {
      const existing = this.getPayment(payment.taskId, payment.kind)
      if (existing) return existing
      this.run(
        `INSERT INTO payments (id, task_id, kind, idempotency_key, provider, amount_micro, recipient, status,
           tx_hash, raw_tx, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        payment.id,
        payment.taskId,
        payment.kind,
        payment.idempotencyKey,
        payment.provider,
        payment.amountMicro.toString(),
        payment.recipient,
        payment.status,
        payment.txHash,
        payment.rawTx,
        payment.error,
        payment.createdAt,
        payment.updatedAt,
      )
      return payment
    })
  }

  updatePayment(
    id: string,
    patch: { status: PaymentStatus; txHash?: Hex | null; rawTx?: Hex | null; error?: string | null },
    at: number,
  ): PaymentRecord {
    this.run(
      `UPDATE payments SET status = ?, tx_hash = COALESCE(?, tx_hash), raw_tx = COALESCE(?, raw_tx), error = ?, updated_at = ?
       WHERE id = ? AND status != 'confirmed'`,
      patch.status,
      patch.txHash ?? null,
      patch.rawTx ?? null,
      patch.error ?? null,
      at,
      id,
    )
    const row = this.get('SELECT * FROM payments WHERE id = ?', id)
    if (!row) throw new NotFoundError(`payment ${id}`)
    return rowToPayment(row)
  }

  confirmedPayoutsTo(recipient: Address): PaymentRecord[] {
    return this.all(
      "SELECT * FROM payments WHERE kind = 'release' AND status = 'confirmed' AND recipient = ? ORDER BY updated_at DESC",
      recipient,
    ).map(rowToPayment)
  }

  /** Sum of payouts committed (submitted or confirmed) since a timestamp. */
  releasedSince(since: number): bigint {
    const rows = this.all(
      "SELECT amount_micro FROM payments WHERE kind = 'release' AND status IN ('submitted', 'confirmed', 'pending') AND created_at >= ?",
      since,
    )
    return rows.reduce((sum, row) => sum + BigInt(str(row, 'amount_micro')), 0n)
  }

  /** Rewards reserved for tasks that are funded and not yet paid or refunded. */
  outstandingEscrow(): bigint {
    const rows = this.all(
      `SELECT p.amount_micro FROM payments p
       WHERE p.kind = 'fund' AND p.status = 'confirmed'
         AND NOT EXISTS (SELECT 1 FROM payments q WHERE q.task_id = p.task_id AND q.kind IN ('release', 'refund') AND q.status = 'confirmed')`,
    )
    return rows.reduce((sum, row) => sum + BigInt(str(row, 'amount_micro')), 0n)
  }

  /** Totals across settled work, straight from the ledger. */
  settlementTotals(): { paidMicro: bigint; paidCount: number; refundedCount: number } {
    const rows = this.all("SELECT kind, amount_micro FROM payments WHERE kind IN ('release', 'refund') AND status = 'confirmed'")
    let paidMicro = 0n
    let paidCount = 0
    let refundedCount = 0
    for (const row of rows) {
      if (str(row, 'kind') === 'release') {
        paidMicro += BigInt(str(row, 'amount_micro'))
        paidCount++
      } else {
        refundedCount++
      }
    }
    return { paidMicro, paidCount, refundedCount }
  }

  // ---- receipts ------------------------------------------------------------

  insertReceipt(receipt: StoredReceipt): void {
    this.run(
      'INSERT INTO receipts (task_id, outcome, created_at, body_json, digest) VALUES (?, ?, ?, ?, ?)',
      receipt.taskId,
      receipt.outcome,
      receipt.createdAt,
      receipt.bodyJson,
      receipt.digest,
    )
  }

  getReceipt(taskId: string): StoredReceipt | null {
    const row = this.get('SELECT * FROM receipts WHERE task_id = ?', taskId)
    if (!row) return null
    return {
      taskId: str(row, 'task_id'),
      outcome: str(row, 'outcome'),
      createdAt: num(row, 'created_at'),
      bodyJson: str(row, 'body_json'),
      digest: str(row, 'digest'),
    }
  }

  listReceipts(limit: number): StoredReceipt[] {
    return this.all('SELECT * FROM receipts ORDER BY created_at DESC LIMIT ?', limit).map((row) => ({
      taskId: str(row, 'task_id'),
      outcome: str(row, 'outcome'),
      createdAt: num(row, 'created_at'),
      bodyJson: str(row, 'body_json'),
      digest: str(row, 'digest'),
    }))
  }

  // ---- agent ---------------------------------------------------------------

  insertTick(tick: AgentTickRecord): void {
    this.run(
      'INSERT INTO agent_ticks (id, source, started_at, finished_at, status, summary) VALUES (?, ?, ?, ?, ?, ?)',
      tick.id,
      tick.source,
      tick.startedAt,
      tick.finishedAt,
      tick.status,
      tick.summary,
    )
  }

  finishTick(id: string, status: AgentTickRecord['status'], summary: string, at: number): void {
    this.run('UPDATE agent_ticks SET status = ?, summary = ?, finished_at = ? WHERE id = ?', status, summary, at, id)
  }

  listTicks(limit: number): AgentTickRecord[] {
    return this.all('SELECT * FROM agent_ticks ORDER BY started_at DESC LIMIT ?', limit).map(rowToTick)
  }

  insertRun(run: AgentRunRecord): void {
    this.run(
      'INSERT INTO agent_runs (id, tick_id, source, action, task_id, at, result, detail, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      run.id,
      run.tickId,
      run.source,
      run.action,
      run.taskId,
      run.at,
      run.result,
      run.detail,
      run.error,
    )
  }

  listRuns(limit: number, taskId?: string): AgentRunRecord[] {
    if (taskId) {
      return this.all('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY at DESC, rowid DESC LIMIT ?', taskId, limit).map(
        rowToRun,
      )
    }
    return this.all('SELECT * FROM agent_runs ORDER BY at DESC, rowid DESC LIMIT ?', limit).map(rowToRun)
  }

  // ---- leases --------------------------------------------------------------

  /** A crash-safe mutex: the lease expires on its own if the holder dies. */
  acquireLease(name: string, holder: string, now: number, ttlMs: number): boolean {
    return this.transaction(() => {
      const row = this.get('SELECT holder, expires_at FROM leases WHERE name = ?', name)
      if (row && num(row, 'expires_at') > now && str(row, 'holder') !== holder) return false
      this.run(
        'INSERT INTO leases (name, holder, expires_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at',
        name,
        holder,
        now + ttlMs,
      )
      return true
    })
  }

  releaseLease(name: string, holder: string): void {
    this.run('DELETE FROM leases WHERE name = ? AND holder = ?', name, holder)
  }

  currentLease(name: string, now: number): { holder: string; expiresAt: number } | null {
    const row = this.get('SELECT holder, expires_at FROM leases WHERE name = ? AND expires_at > ?', name, now)
    return row ? { holder: str(row, 'holder'), expiresAt: num(row, 'expires_at') } : null
  }
}
