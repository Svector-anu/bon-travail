/**
 * Integrity lives in the schema, not only in application code:
 * - one payment row per (task, kind), so a payout can never be issued twice
 * - one submitted attempt per (task, worker), so answers cannot be replayed
 * - task_events and receipts reject UPDATE/DELETE, so history is append-only
 *   and a receipt is frozen the moment it is written
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reward_micro TEXT NOT NULL,
  currency TEXT NOT NULL,
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  expected_json TEXT NOT NULL,
  deadline_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  claimant TEXT,
  claim_id TEXT,
  claim_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  funded_at INTEGER,
  opened_at INTEGER,
  claimed_at INTEGER,
  submitted_at INTEGER,
  settled_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tasks_state ON tasks(state);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  claim_id TEXT NOT NULL UNIQUE,
  claim_token_hash TEXT NOT NULL,
  worker TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  claim_expires_at INTEGER NOT NULL,
  submitted_at INTEGER,
  submission_json TEXT,
  verification_json TEXT,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS attempts_task ON attempts(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_submission_per_worker
  ON attempts(task_id, worker) WHERE submitted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_events_task ON task_events(task_id);
CREATE TRIGGER IF NOT EXISTS task_events_no_update BEFORE UPDATE ON task_events
  BEGIN SELECT RAISE(ABORT, 'task_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS task_events_no_delete BEFORE DELETE ON task_events
  BEGIN SELECT RAISE(ABORT, 'task_events is append-only'); END;

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  recipient TEXT,
  status TEXT NOT NULL,
  tx_hash TEXT,
  raw_tx TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (task_id, kind)
);

CREATE TABLE IF NOT EXISTS receipts (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  digest TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS receipts_no_update BEFORE UPDATE ON receipts
  BEGIN SELECT RAISE(ABORT, 'receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS receipts_no_delete BEFORE DELETE ON receipts
  BEGIN SELECT RAISE(ABORT, 'receipts are immutable'); END;

CREATE TABLE IF NOT EXISTS agent_ticks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS agent_ticks_started ON agent_ticks(started_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  tick_id TEXT,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  task_id TEXT,
  at INTEGER NOT NULL,
  result TEXT NOT NULL,
  detail TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS agent_runs_at ON agent_runs(at);

CREATE TABLE IF NOT EXISTS leases (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`
