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
  TaskSpec,
  VerificationResult,
} from '@/domain/types'
import { fromJson, num, optNum, optStr, str, toJson } from './codec'
import { openDatabase, TransactionScope, type Database, type Row, type SqlExecutor } from './db'
import { SCHEMA } from './schema'

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
    | 'claimantHandle'
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
  claimantHandle: 'claimant_handle',
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
    subject: str(row, 'subject'),
    spec: fromJson<TaskSpec>(str(row, 'spec_json')),
    deadlineAt: num(row, 'deadline_at'),
    state: str(row, 'state') as TaskState,
    claimant: optStr(row, 'claimant') as Address | null,
    claimantHandle: optStr(row, 'claimant_handle'),
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
    handle: optStr(row, 'handle'),
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

function rowToReceipt(row: Row): StoredReceipt {
  return {
    taskId: str(row, 'task_id'),
    outcome: str(row, 'outcome'),
    createdAt: num(row, 'created_at'),
    bodyJson: str(row, 'body_json'),
    digest: str(row, 'digest'),
  }
}

export interface StoredReceipt {
  taskId: string
  outcome: string
  createdAt: number
  bodyJson: string
  digest: string
}

export interface NewAttempt {
  attempt: AttemptRecord
  claimTokenHash: string
  identity: string | null
  singleSubmission: boolean
}

/** Shared by Store and WatchStore: one database, one transaction scope. */
export abstract class Repository {
  constructor(
    protected readonly db: Database,
    protected readonly scope: TransactionScope,
  ) {}

  protected get exec(): SqlExecutor {
    return this.scope.executor
  }

  protected async get(sql: string, ...params: unknown[]): Promise<Row | undefined> {
    return (await this.exec.query(sql, params)).rows[0]
  }

  protected async all(sql: string, ...params: unknown[]): Promise<Row[]> {
    return (await this.exec.query(sql, params)).rows
  }

  protected async run(sql: string, ...params: unknown[]): Promise<number> {
    return (await this.exec.query(sql, params)).rowCount
  }

  /** Joins the caller's transaction if there is one. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.scope.run(fn)
  }
}

const initialised = new WeakSet<Database>()

export async function prepareDatabase(db: Database): Promise<void> {
  if (initialised.has(db)) return
  await db.exec(SCHEMA)
  initialised.add(db)
}

function taskFilter(options: { states?: readonly TaskState[]; kinds?: readonly TaskRecord['kind'][] }): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (options.states && options.states.length > 0) {
    params.push([...options.states])
    clauses.push(`state = ANY($${params.length})`)
  }
  if (options.kinds && options.kinds.length > 0) {
    params.push([...options.kinds])
    clauses.push(`kind = ANY($${params.length})`)
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export class Store extends Repository {
  static async open(target: string): Promise<Store> {
    const db = await openDatabase(target)
    await prepareDatabase(db)
    return new Store(db, new TransactionScope(db))
  }

  get database(): Database {
    return this.db
  }

  get transactions(): TransactionScope {
    return this.scope
  }

  close(): Promise<void> {
    return this.db.close()
  }

  // ---- tasks ---------------------------------------------------------------

  async nextTaskSeq(): Promise<number> {
    const row = await this.get('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tasks')
    return row ? num(row, 'next') : 1
  }

  async hasTaskForSubject(subject: string): Promise<boolean> {
    return (await this.get('SELECT 1 FROM tasks WHERE subject = $1', subject.toLowerCase())) !== undefined
  }

  async insertTask(task: TaskRecord, actor: string, detail: Record<string, unknown> = {}): Promise<void> {
    await this.transaction(async () => {
      await this.run(
        `INSERT INTO tasks (id, seq, kind, title, description, reward_micro, currency, chain, subject,
           spec_json, deadline_at, state, created_at, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0)`,
        task.id,
        task.seq,
        task.kind,
        task.title,
        task.description,
        task.rewardMicro.toString(),
        task.currency,
        task.chain,
        task.subject.toLowerCase(),
        toJson(task.spec),
        task.deadlineAt,
        task.state,
        task.createdAt,
      )
      await this.appendEvent(task.id, task.createdAt, 'created', null, task.state, actor, {
        subject: task.subject,
        reward: task.rewardMicro,
        ...detail,
      })
    })
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    const row = await this.get('SELECT * FROM tasks WHERE id = $1', id)
    return row ? rowToTask(row) : null
  }

  async requireTask(id: string): Promise<TaskRecord> {
    const task = await this.getTask(id)
    if (!task) throw new NotFoundError(`task ${id}`)
    return task
  }

  /** Locks the task row for the rest of the current transaction. */
  async lockTask(id: string): Promise<TaskRecord> {
    const row = await this.get('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', id)
    if (!row) throw new NotFoundError(`task ${id}`)
    return rowToTask(row)
  }

  async listTasks(
    options: { states?: readonly TaskState[]; kinds?: readonly TaskRecord['kind'][]; limit?: number; offset?: number } = {},
  ): Promise<TaskRecord[]> {
    const { where, params } = taskFilter(options)
    params.push(options.limit ?? 100)
    const limit = `$${params.length}`
    params.push(Math.max(0, options.offset ?? 0))
    const sql = `SELECT * FROM tasks ${where} ORDER BY seq DESC LIMIT ${limit} OFFSET $${params.length}`
    return (await this.all(sql, ...params)).map(rowToTask)
  }

  async countTasks(options: { states?: readonly TaskState[]; kinds?: readonly TaskRecord['kind'][] } = {}): Promise<number> {
    const { where, params } = taskFilter(options)
    const row = await this.get(`SELECT COUNT(*) AS n FROM tasks ${where}`, ...params)
    return Number(row?.n ?? 0)
  }

  /**
   * The only way a task changes state. Locks the row, checks the current
   * state and the legal-transition table, bumps the version and appends the
   * event, all in one transaction. Throws StaleStateError if another writer
   * got there first.
   */
  async transition(input: TransitionInput): Promise<TaskRecord> {
    return this.transaction(async () => {
      const task = await this.lockTask(input.taskId)
      const allowed: readonly TaskState[] = typeof input.from === 'string' ? [input.from] : input.from
      if (!allowed.includes(task.state)) throw new StaleStateError(task.id, allowed, task.state)
      assertTransition(task.id, task.state, input.to)

      const sets = ['state = $1', 'version = version + 1']
      const values: unknown[] = [input.to]
      for (const [key, value] of Object.entries(input.patch ?? {}) as [keyof TaskPatch, TaskPatch[keyof TaskPatch]][]) {
        values.push(value ?? null)
        sets.push(`${PATCH_COLUMNS[key]} = $${values.length}`)
      }
      values.push(task.id, task.version)
      const changed = await this.run(
        `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND version = $${values.length}`,
        ...values,
      )
      if (changed !== 1) throw new StaleStateError(task.id, allowed, task.state)

      await this.appendEvent(task.id, input.at, input.event, task.state, input.to, input.actor, input.detail ?? {})
      return this.requireTask(task.id)
    })
  }

  // ---- events --------------------------------------------------------------

  async appendEvent(
    taskId: string,
    at: number,
    type: TaskEventType,
    fromState: TaskState | null,
    toState: TaskState | null,
    actor: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.run(
      'INSERT INTO task_events (task_id, at, type, from_state, to_state, actor, detail_json) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      taskId,
      at,
      type,
      fromState,
      toState,
      actor,
      toJson(detail),
    )
  }

  async listEvents(taskId: string): Promise<TaskEvent[]> {
    return (await this.all('SELECT * FROM task_events WHERE task_id = $1 ORDER BY id ASC', taskId)).map(rowToEvent)
  }

  // ---- attempts ------------------------------------------------------------

  async insertAttempt({ attempt, claimTokenHash, identity, singleSubmission }: NewAttempt): Promise<void> {
    await this.run(
      `INSERT INTO attempts (id, task_id, claim_id, claim_token_hash, worker, handle, identity, single_submission,
         claimed_at, claim_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      attempt.id,
      attempt.taskId,
      attempt.claimId,
      claimTokenHash,
      attempt.worker,
      attempt.handle,
      identity,
      singleSubmission,
      attempt.claimedAt,
      attempt.claimExpiresAt,
    )
  }

  async getAttemptByClaim(claimId: string): Promise<{ attempt: AttemptRecord; claimTokenHash: string } | null> {
    const row = await this.get('SELECT * FROM attempts WHERE claim_id = $1', claimId)
    return row ? { attempt: rowToAttempt(row), claimTokenHash: str(row, 'claim_token_hash') } : null
  }

  async listAttempts(taskId: string): Promise<AttemptRecord[]> {
    return (await this.all('SELECT * FROM attempts WHERE task_id = $1 ORDER BY claimed_at ASC, id ASC', taskId)).map(rowToAttempt)
  }

  async countAttempts(taskIds: readonly string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map()
    const rows = await this.all('SELECT task_id, COUNT(*) AS n FROM attempts WHERE task_id = ANY($1) GROUP BY task_id', [...taskIds])
    return new Map(rows.map((row) => [str(row, 'task_id'), num(row, 'n')]))
  }

  async workerHasSubmitted(taskId: string, worker: Address): Promise<boolean> {
    return (
      (await this.get('SELECT 1 FROM attempts WHERE task_id = $1 AND worker = $2 AND submitted_at IS NOT NULL', taskId, worker)) !==
      undefined
    )
  }

  async listAttemptsByWorker(worker: Address, limit = 50): Promise<AttemptRecord[]> {
    return (await this.all('SELECT * FROM attempts WHERE worker = $1 ORDER BY claimed_at DESC LIMIT $2', worker, limit)).map(
      rowToAttempt,
    )
  }

  async listAttemptsByHandle(handle: string, limit = 50): Promise<AttemptRecord[]> {
    return (
      await this.all('SELECT * FROM attempts WHERE lower(handle) = lower($1) ORDER BY claimed_at DESC LIMIT $2', handle, limit)
    ).map(rowToAttempt)
  }

  async identityHasSubmitted(taskId: string, identity: string): Promise<boolean> {
    return (
      (await this.get(
        'SELECT 1 FROM attempts WHERE task_id = $1 AND identity = $2 AND submitted_at IS NOT NULL',
        taskId,
        identity,
      )) !== undefined
    )
  }

  async recordSubmission(claimId: string, submission: Submission, at: number): Promise<void> {
    const changed = await this.run(
      'UPDATE attempts SET submission_json = $1, submitted_at = $2 WHERE claim_id = $3 AND submitted_at IS NULL',
      toJson(submission),
      at,
      claimId,
    )
    if (changed !== 1) throw new Error(`claim ${claimId} already has a submission`)
  }

  /** Verification verdicts are written once and never overwritten. */
  async recordVerdict(claimId: string, verification: VerificationResult, outcome: AttemptOutcome): Promise<void> {
    const changed = await this.run(
      'UPDATE attempts SET verification_json = $1, outcome = $2 WHERE claim_id = $3 AND outcome IS NULL',
      toJson(verification),
      outcome,
      claimId,
    )
    if (changed !== 1) throw new Error(`claim ${claimId} already has a verdict`)
  }

  async markAttemptLapsed(claimId: string): Promise<void> {
    await this.run(
      "UPDATE attempts SET outcome = 'LAPSED' WHERE claim_id = $1 AND outcome IS NULL AND submitted_at IS NULL",
      claimId,
    )
  }

  // ---- payments ------------------------------------------------------------

  async getPayment(taskId: string, kind: PaymentKind): Promise<PaymentRecord | null> {
    const row = await this.get('SELECT * FROM payments WHERE task_id = $1 AND kind = $2', taskId, kind)
    return row ? rowToPayment(row) : null
  }

  async listPayments(taskId: string): Promise<PaymentRecord[]> {
    return (await this.all('SELECT * FROM payments WHERE task_id = $1 ORDER BY created_at ASC, kind ASC', taskId)).map(
      rowToPayment,
    )
  }

  /** Inserts the payment intent; returns the existing row if one already exists. */
  async ensurePayment(payment: PaymentRecord): Promise<PaymentRecord> {
    await this.run(
      `INSERT INTO payments (id, task_id, kind, idempotency_key, provider, amount_micro, recipient, status,
         tx_hash, raw_tx, error, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (task_id, kind) DO NOTHING`,
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
    const stored = await this.getPayment(payment.taskId, payment.kind)
    if (!stored) throw new NotFoundError(`payment ${payment.kind} for ${payment.taskId}`)
    return stored
  }

  async updatePayment(
    id: string,
    patch: { status: PaymentStatus; txHash?: Hex | null; rawTx?: Hex | null; error?: string | null },
    at: number,
  ): Promise<PaymentRecord> {
    await this.run(
      `UPDATE payments SET status = $1, tx_hash = COALESCE($2, tx_hash), raw_tx = COALESCE($3, raw_tx), error = $4, updated_at = $5
       WHERE id = $6 AND status != 'confirmed'`,
      patch.status,
      patch.txHash ?? null,
      patch.rawTx ?? null,
      patch.error ?? null,
      at,
      id,
    )
    const row = await this.get('SELECT * FROM payments WHERE id = $1', id)
    if (!row) throw new NotFoundError(`payment ${id}`)
    return rowToPayment(row)
  }

  async confirmedPayoutsTo(recipient: Address): Promise<PaymentRecord[]> {
    return (
      await this.all(
        "SELECT * FROM payments WHERE kind = 'release' AND status = 'confirmed' AND recipient = $1 ORDER BY updated_at DESC",
        recipient,
      )
    ).map(rowToPayment)
  }

  /** Sum of payouts committed (submitted or confirmed) since a timestamp. */
  async releasedSince(since: number): Promise<bigint> {
    const rows = await this.all(
      "SELECT amount_micro FROM payments WHERE kind = 'release' AND status IN ('submitted', 'confirmed', 'pending') AND created_at >= $1",
      since,
    )
    return rows.reduce((sum, row) => sum + BigInt(str(row, 'amount_micro')), 0n)
  }

  /** Rewards reserved for tasks that are funded and not yet paid or refunded. */
  async outstandingEscrow(): Promise<bigint> {
    const rows = await this.all(
      `SELECT p.amount_micro FROM payments p
       WHERE p.kind = 'fund' AND p.status = 'confirmed'
         AND NOT EXISTS (SELECT 1 FROM payments q WHERE q.task_id = p.task_id AND q.kind IN ('release', 'refund') AND q.status = 'confirmed')`,
    )
    return rows.reduce((sum, row) => sum + BigInt(str(row, 'amount_micro')), 0n)
  }

  // ---- receipts ------------------------------------------------------------

  async insertReceipt(receipt: StoredReceipt): Promise<void> {
    await this.run(
      'INSERT INTO receipts (task_id, outcome, created_at, body_json, digest) VALUES ($1, $2, $3, $4, $5)',
      receipt.taskId,
      receipt.outcome,
      receipt.createdAt,
      receipt.bodyJson,
      receipt.digest,
    )
  }

  async getReceipt(taskId: string): Promise<StoredReceipt | null> {
    const row = await this.get('SELECT * FROM receipts WHERE task_id = $1', taskId)
    return row ? rowToReceipt(row) : null
  }

  async listReceipts(limit: number): Promise<StoredReceipt[]> {
    return (await this.all('SELECT * FROM receipts ORDER BY created_at DESC LIMIT $1', limit)).map(rowToReceipt)
  }

  // ---- agent ---------------------------------------------------------------

  async insertTick(tick: AgentTickRecord): Promise<void> {
    await this.run(
      'INSERT INTO agent_ticks (id, source, started_at, finished_at, status, summary) VALUES ($1, $2, $3, $4, $5, $6)',
      tick.id,
      tick.source,
      tick.startedAt,
      tick.finishedAt,
      tick.status,
      tick.summary,
    )
  }

  async finishTick(id: string, status: AgentTickRecord['status'], summary: string, at: number): Promise<void> {
    await this.run('UPDATE agent_ticks SET status = $1, summary = $2, finished_at = $3 WHERE id = $4', status, summary, at, id)
  }

  async listTicks(limit: number): Promise<AgentTickRecord[]> {
    return (await this.all('SELECT * FROM agent_ticks ORDER BY started_at DESC LIMIT $1', limit)).map(rowToTick)
  }

  async insertRun(run: AgentRunRecord & { findingId?: string | null }): Promise<void> {
    await this.run(
      `INSERT INTO agent_runs (id, tick_id, source, action, task_id, finding_id, at, result, detail, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      run.id,
      run.tickId,
      run.source,
      run.action,
      run.taskId,
      run.findingId ?? null,
      run.at,
      run.result,
      run.detail,
      run.error,
    )
  }

  async listRuns(limit: number, filter: { taskId?: string; findingId?: string } = {}): Promise<AgentRunRecord[]> {
    if (filter.taskId) {
      return (
        await this.all('SELECT * FROM agent_runs WHERE task_id = $1 ORDER BY at DESC, ord DESC LIMIT $2', filter.taskId, limit)
      ).map(rowToRun)
    }
    if (filter.findingId) {
      return (
        await this.all('SELECT * FROM agent_runs WHERE finding_id = $1 ORDER BY at DESC, ord DESC LIMIT $2', filter.findingId, limit)
      ).map(rowToRun)
    }
    return (await this.all('SELECT * FROM agent_runs ORDER BY at DESC, ord DESC LIMIT $1', limit)).map(rowToRun)
  }

  // ---- leases --------------------------------------------------------------

  /** A crash-safe mutex: the lease expires on its own if the holder dies. */
  async acquireLease(name: string, holder: string, now: number, ttlMs: number): Promise<boolean> {
    const row = await this.get(
      `INSERT INTO leases (name, holder, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
         WHERE leases.expires_at <= $4 OR leases.holder = EXCLUDED.holder
       RETURNING holder`,
      name,
      holder,
      now + ttlMs,
      now,
    )
    return row !== undefined
  }

  async releaseLease(name: string, holder: string): Promise<void> {
    await this.run('DELETE FROM leases WHERE name = $1 AND holder = $2', name, holder)
  }

  async currentLease(name: string, now: number): Promise<{ holder: string; expiresAt: number } | null> {
    const row = await this.get('SELECT holder, expires_at FROM leases WHERE name = $1 AND expires_at > $2', name, now)
    return row ? { holder: str(row, 'holder'), expiresAt: num(row, 'expires_at') } : null
  }
}

