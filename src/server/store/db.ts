import { AsyncLocalStorage } from 'node:async_hooks'

export type Row = Record<string, unknown>

export interface QueryResult {
  rows: Row[]
  rowCount: number
}

export interface SqlExecutor {
  query(sql: string, params?: readonly unknown[]): Promise<QueryResult>
}

/** The one database seam: PGlite in tests and local dev, Neon Postgres in production. */
export interface Database extends SqlExecutor {
  readonly label: string
  /** Runs several statements with no parameters (schema setup). */
  exec(sql: string): Promise<void>
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>
  close(): Promise<void>
}

class PgliteDatabase implements Database {
  readonly label = 'pglite'

  constructor(private readonly pg: import('@electric-sql/pglite').PGlite) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<QueryResult> {
    const result = await this.pg.query<Row>(sql, [...params])
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  }

  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql)
  }

  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) =>
      fn({
        query: async (sql, params = []) => {
          const result = await tx.query<Row>(sql, [...params])
          return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
        },
      }),
    )
  }

  close(): Promise<void> {
    return this.pg.close()
  }
}

class NeonDatabase implements Database {
  readonly label = 'neon'

  constructor(private readonly pool: import('@neondatabase/serverless').Pool) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<QueryResult> {
    const result = await this.pool.query(sql, params.length ? [...params] : undefined)
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 }
  }

  /** Serverless instances can cold-start together; the advisory lock keeps schema setup one at a time. */
  async exec(sql: string): Promise<void> {
    await this.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(727274)')
      await tx.query(sql)
    })
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn({
        query: async (sql, params = []) => {
          const r = await client.query(sql, params.length ? [...params] : undefined)
          return { rows: r.rows as Row[], rowCount: r.rowCount ?? 0 }
        },
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  close(): Promise<void> {
    return this.pool.end()
  }
}

/**
 * DATABASE_URL selects Neon; anything else is a PGlite data directory
 * (":memory:" for tests). The drivers are imported lazily so the
 * production bundle never loads the WASM Postgres.
 */
export async function openDatabase(target: string): Promise<Database> {
  if (/^postgres(ql)?:\/\//.test(target)) {
    const { Pool, neonConfig } = await import('@neondatabase/serverless')
    if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket
    return new NeonDatabase(new Pool({ connectionString: target, max: 3 }))
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = target === ':memory:' ? new PGlite() : new PGlite(target)
  await pg.waitReady
  return new PgliteDatabase(pg)
}

/**
 * Carries the active transaction through async calls, so a store method
 * called inside Store.transaction joins it instead of opening its own.
 */
export class TransactionScope {
  private readonly als = new AsyncLocalStorage<SqlExecutor>()

  constructor(private readonly db: Database) {}

  get executor(): SqlExecutor {
    return this.als.getStore() ?? this.db
  }

  get active(): boolean {
    return this.als.getStore() !== undefined
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active) return fn()
    return this.db.transaction((tx) => this.als.run(tx, fn))
  }
}
