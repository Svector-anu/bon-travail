/**
 * Integrity lives in the schema, not only in application code:
 * - one payment row per (task, kind), so a payout can never be issued twice
 * - one submitted attempt per (task, worker) for single-answer tasks, so
 *   answers cannot be replayed
 * - task_events, finding_events and receipts reject UPDATE and DELETE, so
 *   history is append-only and a receipt is frozen the moment it is written
 *
 * Timestamps are epoch milliseconds in BIGINT; money is integer micro-USDC
 * stored as text so it round-trips as bigint without float loss.
 */
export const SCHEMA = `
CREATE OR REPLACE FUNCTION proofwork_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '%', TG_ARGV[0];
END
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reward_micro TEXT NOT NULL,
  currency TEXT NOT NULL,
  chain TEXT NOT NULL,
  subject TEXT NOT NULL UNIQUE,
  spec_json TEXT NOT NULL,
  deadline_at BIGINT NOT NULL,
  state TEXT NOT NULL,
  claimant TEXT,
  claimant_handle TEXT,
  claim_id TEXT,
  claim_expires_at BIGINT,
  created_at BIGINT NOT NULL,
  funded_at BIGINT,
  opened_at BIGINT,
  claimed_at BIGINT,
  submitted_at BIGINT,
  settled_at BIGINT,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tasks_state ON tasks(state);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  claim_id TEXT NOT NULL UNIQUE,
  claim_token_hash TEXT NOT NULL,
  worker TEXT NOT NULL,
  handle TEXT,
  identity TEXT,
  single_submission BOOLEAN NOT NULL,
  claimed_at BIGINT NOT NULL,
  claim_expires_at BIGINT NOT NULL,
  submitted_at BIGINT,
  submission_json TEXT,
  verification_json TEXT,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS attempts_task ON attempts(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_submission_per_worker
  ON attempts(task_id, worker) WHERE submitted_at IS NOT NULL AND single_submission;
CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_submission_per_identity
  ON attempts(task_id, identity) WHERE submitted_at IS NOT NULL AND identity IS NOT NULL AND single_submission;

CREATE TABLE IF NOT EXISTS task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  at BIGINT NOT NULL,
  type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_events_task ON task_events(task_id);
CREATE OR REPLACE TRIGGER task_events_append_only BEFORE UPDATE OR DELETE ON task_events
  FOR EACH ROW EXECUTE FUNCTION proofwork_append_only('task_events is append-only');

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
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (task_id, kind)
);

CREATE TABLE IF NOT EXISTS receipts (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  outcome TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  body_json TEXT NOT NULL,
  digest TEXT NOT NULL
);
CREATE OR REPLACE TRIGGER receipts_immutable BEFORE UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION proofwork_append_only('receipts are immutable');

CREATE TABLE IF NOT EXISTS agent_ticks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  status TEXT NOT NULL,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS agent_ticks_started ON agent_ticks(started_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  ord BIGSERIAL,
  id TEXT PRIMARY KEY,
  tick_id TEXT,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  task_id TEXT,
  finding_id TEXT,
  at BIGINT NOT NULL,
  result TEXT NOT NULL,
  detail TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS agent_runs_at ON agent_runs(at);

CREATE TABLE IF NOT EXISTS leases (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  workflow_path TEXT NOT NULL,
  workflow_id BIGINT NOT NULL,
  workflow_name TEXT NOT NULL,
  connected_by TEXT NOT NULL,
  connected_at BIGINT NOT NULL,
  last_polled_at BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id BIGINT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  run_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  event TEXT NOT NULL,
  conclusion TEXT NOT NULL,
  html_url TEXT NOT NULL,
  run_created_at BIGINT NOT NULL,
  failing_job TEXT,
  failing_step TEXT,
  signature TEXT,
  finding_id TEXT,
  observed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_runs_repo ON workflow_runs(repo_id, run_created_at);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  signature TEXT NOT NULL,
  workflow_path TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  step_name TEXT NOT NULL,
  step_command TEXT,
  error_excerpt TEXT,
  failure_count INTEGER NOT NULL,
  first_failed_run_id BIGINT NOT NULL,
  first_failed_sha TEXT NOT NULL,
  first_failed_at BIGINT NOT NULL,
  last_failed_run_id BIGINT NOT NULL,
  last_failed_at BIGINT NOT NULL,
  last_failed_run_url TEXT NOT NULL,
  regression_json TEXT,
  status TEXT NOT NULL,
  investigation_json TEXT,
  decided_by TEXT,
  decided_at BIGINT,
  task_id TEXT,
  resolved_at BIGINT,
  resolved_run_id BIGINT,
  resolved_sha TEXT,
  recurrence_count INTEGER NOT NULL DEFAULT 0,
  last_recurrence_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, signature)
);

CREATE TABLE IF NOT EXISTS finding_events (
  id BIGSERIAL PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  at BIGINT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finding_events_finding ON finding_events(finding_id);
CREATE OR REPLACE TRIGGER finding_events_append_only BEFORE UPDATE OR DELETE ON finding_events
  FOR EACH ROW EXECUTE FUNCTION proofwork_append_only('finding_events is append-only');
`
