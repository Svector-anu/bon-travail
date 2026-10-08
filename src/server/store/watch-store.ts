import {
  canMoveFinding,
  type BugDetails,
  type BugReportRecord,
  type BugReportStatus,
  type FindingEvent,
  type FindingEventType,
  type FindingRecord,
  type FindingStatus,
  type Investigation,
  type RegressionWindow,
  type RepoRecord,
  type WorkflowRunRecord,
} from '@/domain/findings'
import { DomainError } from '../errors'
import { fromJson, num, optNum, optStr, str, toJson } from './codec'
import type { Row } from './db'
import { NotFoundError, Repository } from './store'

function rowToRepo(row: Row): RepoRecord {
  return {
    id: str(row, 'id'),
    owner: str(row, 'owner'),
    name: str(row, 'name'),
    defaultBranch: str(row, 'default_branch'),
    workflowPath: str(row, 'workflow_path'),
    workflowId: num(row, 'workflow_id'),
    workflowName: str(row, 'workflow_name'),
    connectedBy: str(row, 'connected_by'),
    connectedAt: num(row, 'connected_at'),
    lastPolledAt: optNum(row, 'last_polled_at'),
    active: row.active === true,
    private: row.private === true,
  }
}

function rowToWorkflowRun(row: Row): WorkflowRunRecord {
  return {
    runId: num(row, 'run_id'),
    repoId: str(row, 'repo_id'),
    runNumber: num(row, 'run_number'),
    headSha: str(row, 'head_sha'),
    headBranch: str(row, 'head_branch'),
    event: str(row, 'event'),
    conclusion: str(row, 'conclusion'),
    htmlUrl: str(row, 'html_url'),
    runCreatedAt: num(row, 'run_created_at'),
    failingJob: optStr(row, 'failing_job'),
    failingStep: optStr(row, 'failing_step'),
    signature: optStr(row, 'signature'),
    findingId: optStr(row, 'finding_id'),
    observedAt: num(row, 'observed_at'),
  }
}

function rowToFinding(row: Row): FindingRecord {
  const regression = optStr(row, 'regression_json')
  const investigation = optStr(row, 'investigation_json')
  const bug = optStr(row, 'bug_json')
  return {
    id: str(row, 'id'),
    seq: num(row, 'seq'),
    repoId: str(row, 'repo_id'),
    signature: str(row, 'signature'),
    workflowPath: str(row, 'workflow_path'),
    workflowName: str(row, 'workflow_name'),
    jobName: str(row, 'job_name'),
    stepName: str(row, 'step_name'),
    stepCommand: optStr(row, 'step_command'),
    errorExcerpt: optStr(row, 'error_excerpt'),
    failureCount: num(row, 'failure_count'),
    firstFailedRunId: num(row, 'first_failed_run_id'),
    firstFailedSha: str(row, 'first_failed_sha'),
    firstFailedAt: num(row, 'first_failed_at'),
    lastFailedRunId: num(row, 'last_failed_run_id'),
    lastFailedAt: num(row, 'last_failed_at'),
    lastFailedRunUrl: str(row, 'last_failed_run_url'),
    regression: regression ? fromJson<RegressionWindow>(regression) : null,
    status: str(row, 'status') as FindingStatus,
    investigation: investigation ? fromJson<Investigation>(investigation) : null,
    decidedBy: optStr(row, 'decided_by'),
    decidedAt: optNum(row, 'decided_at'),
    taskId: optStr(row, 'task_id'),
    resolvedAt: optNum(row, 'resolved_at'),
    resolvedRunId: optNum(row, 'resolved_run_id'),
    resolvedSha: optStr(row, 'resolved_sha'),
    recurrenceCount: num(row, 'recurrence_count'),
    lastRecurrenceAt: optNum(row, 'last_recurrence_at'),
    bug: bug ? fromJson<BugDetails>(bug) : null,
    createdAt: num(row, 'created_at'),
    updatedAt: num(row, 'updated_at'),
    version: num(row, 'version'),
  }
}

function rowToBugReport(row: Row): BugReportRecord {
  return {
    id: str(row, 'id'),
    seq: num(row, 'seq'),
    repoId: str(row, 'repo_id'),
    issueNumber: num(row, 'issue_number'),
    issueTitle: str(row, 'issue_title'),
    issueBody: str(row, 'issue_body'),
    issueUrl: str(row, 'issue_url'),
    issueAuthor: str(row, 'issue_author'),
    status: str(row, 'status') as BugReportStatus,
    note: optStr(row, 'note'),
    findingId: optStr(row, 'finding_id'),
    reportedAt: num(row, 'reported_at'),
    createdAt: num(row, 'created_at'),
    updatedAt: num(row, 'updated_at'),
  }
}

type FindingPatch = Partial<
  Pick<
    FindingRecord,
    | 'firstFailedRunId'
    | 'firstFailedSha'
    | 'firstFailedAt'
    | 'failureCount'
    | 'lastFailedRunId'
    | 'lastFailedAt'
    | 'lastFailedRunUrl'
    | 'errorExcerpt'
    | 'stepCommand'
    | 'regression'
    | 'investigation'
    | 'decidedBy'
    | 'decidedAt'
    | 'taskId'
    | 'resolvedAt'
    | 'resolvedRunId'
    | 'resolvedSha'
    | 'recurrenceCount'
    | 'lastRecurrenceAt'
  >
>

const FINDING_COLUMNS: Record<keyof FindingPatch, string> = {
  firstFailedRunId: 'first_failed_run_id',
  firstFailedSha: 'first_failed_sha',
  firstFailedAt: 'first_failed_at',
  failureCount: 'failure_count',
  lastFailedRunId: 'last_failed_run_id',
  lastFailedAt: 'last_failed_at',
  lastFailedRunUrl: 'last_failed_run_url',
  errorExcerpt: 'error_excerpt',
  stepCommand: 'step_command',
  regression: 'regression_json',
  investigation: 'investigation_json',
  decidedBy: 'decided_by',
  decidedAt: 'decided_at',
  taskId: 'task_id',
  resolvedAt: 'resolved_at',
  resolvedRunId: 'resolved_run_id',
  resolvedSha: 'resolved_sha',
  recurrenceCount: 'recurrence_count',
  lastRecurrenceAt: 'last_recurrence_at',
}

const JSON_COLUMNS = new Set<keyof FindingPatch>(['regression', 'investigation'])

export interface FindingUpdate {
  findingId: string
  at: number
  actor: string
  /** Omit to keep the status and only record facts. */
  to?: FindingStatus
  from?: readonly FindingStatus[]
  event: FindingEventType
  detail?: Record<string, unknown>
  patch?: FindingPatch
}

/** Repositories under watch, the runs seen on them, and the findings they produced. */
export class WatchStore extends Repository {
  // ---- repos ---------------------------------------------------------------

  async upsertRepo(repo: RepoRecord): Promise<RepoRecord> {
    await this.run(
      `INSERT INTO repos (id, owner, name, default_branch, workflow_path, workflow_id, workflow_name, connected_by,
         connected_at, last_polled_at, active, private)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, TRUE, $10)
       ON CONFLICT (id) DO UPDATE SET default_branch = EXCLUDED.default_branch, workflow_path = EXCLUDED.workflow_path,
         workflow_id = EXCLUDED.workflow_id, workflow_name = EXCLUDED.workflow_name, active = TRUE, private = EXCLUDED.private`,
      repo.id,
      repo.owner,
      repo.name,
      repo.defaultBranch,
      repo.workflowPath,
      repo.workflowId,
      repo.workflowName,
      repo.connectedBy,
      repo.connectedAt,
      repo.private,
    )
    return this.requireRepo(repo.id)
  }

  async getRepo(id: string): Promise<RepoRecord | null> {
    const row = await this.get('SELECT * FROM repos WHERE id = $1', id)
    return row ? rowToRepo(row) : null
  }

  async requireRepo(id: string): Promise<RepoRecord> {
    const repo = await this.getRepo(id)
    if (!repo) throw new NotFoundError(`repository ${id}`)
    return repo
  }

  async listRepos(activeOnly = false): Promise<RepoRecord[]> {
    const sql = activeOnly ? 'SELECT * FROM repos WHERE active ORDER BY connected_at ASC' : 'SELECT * FROM repos ORDER BY connected_at ASC'
    return (await this.all(sql)).map(rowToRepo)
  }

  async setRepoActive(id: string, active: boolean): Promise<void> {
    await this.run('UPDATE repos SET active = $1 WHERE id = $2', active, id)
  }

  async markPolled(id: string, at: number): Promise<void> {
    await this.run('UPDATE repos SET last_polled_at = $1 WHERE id = $2', at, id)
  }

  // ---- runs ----------------------------------------------------------------

  async hasRun(runId: number): Promise<boolean> {
    return (await this.get('SELECT 1 FROM workflow_runs WHERE run_id = $1', runId)) !== undefined
  }

  /** Returns false if the run was already recorded (another poll got it first). */
  async insertRun(run: WorkflowRunRecord): Promise<boolean> {
    const inserted = await this.run(
      `INSERT INTO workflow_runs (run_id, repo_id, run_number, head_sha, head_branch, event, conclusion, html_url,
         run_created_at, failing_job, failing_step, signature, finding_id, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (run_id) DO NOTHING`,
      run.runId,
      run.repoId,
      run.runNumber,
      run.headSha,
      run.headBranch,
      run.event,
      run.conclusion,
      run.htmlUrl,
      run.runCreatedAt,
      run.failingJob,
      run.failingStep,
      run.signature,
      run.findingId,
      run.observedAt,
    )
    return inserted === 1
  }

  async attachRunToFinding(runId: number, findingId: string): Promise<void> {
    await this.run('UPDATE workflow_runs SET finding_id = $1 WHERE run_id = $2', findingId, runId)
  }

  async listRuns(repoId: string, limit = 50): Promise<WorkflowRunRecord[]> {
    return (
      await this.all('SELECT * FROM workflow_runs WHERE repo_id = $1 ORDER BY run_created_at DESC LIMIT $2', repoId, limit)
    ).map(rowToWorkflowRun)
  }

  async runsForFinding(findingId: string, limit = 20): Promise<WorkflowRunRecord[]> {
    return (
      await this.all('SELECT * FROM workflow_runs WHERE finding_id = $1 ORDER BY run_created_at DESC LIMIT $2', findingId, limit)
    ).map(rowToWorkflowRun)
  }

  /** The latest successful run of the watched workflow before a moment. */
  async lastGreenBefore(repoId: string, before: number): Promise<WorkflowRunRecord | null> {
    const row = await this.get(
      `SELECT * FROM workflow_runs WHERE repo_id = $1 AND conclusion = 'success' AND run_created_at < $2
       ORDER BY run_created_at DESC LIMIT 1`,
      repoId,
      before,
    )
    return row ? rowToWorkflowRun(row) : null
  }

  async greenRunsSince(repoId: string, since: number): Promise<number> {
    const row = await this.get(
      "SELECT COUNT(*) AS n FROM workflow_runs WHERE repo_id = $1 AND conclusion = 'success' AND run_created_at > $2",
      repoId,
      since,
    )
    return row ? num(row, 'n') : 0
  }

  // ---- findings ------------------------------------------------------------

  async nextFindingSeq(): Promise<number> {
    const row = await this.get('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM findings')
    return row ? num(row, 'next') : 1
  }

  async insertFinding(finding: FindingRecord, actor: string, detail: Record<string, unknown>): Promise<void> {
    await this.transaction(async () => {
      await this.run(
        `INSERT INTO findings (id, seq, repo_id, signature, workflow_path, workflow_name, job_name, step_name, step_command,
           error_excerpt, failure_count, first_failed_run_id, first_failed_sha, first_failed_at, last_failed_run_id,
           last_failed_at, last_failed_run_url, regression_json, status, investigation_json, bug_json, created_at, updated_at, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 0)`,
        finding.id,
        finding.seq,
        finding.repoId,
        finding.signature,
        finding.workflowPath,
        finding.workflowName,
        finding.jobName,
        finding.stepName,
        finding.stepCommand,
        finding.errorExcerpt,
        finding.failureCount,
        finding.firstFailedRunId,
        finding.firstFailedSha,
        finding.firstFailedAt,
        finding.lastFailedRunId,
        finding.lastFailedAt,
        finding.lastFailedRunUrl,
        finding.regression ? toJson(finding.regression) : null,
        finding.status,
        finding.investigation ? toJson(finding.investigation) : null,
        finding.bug ? toJson(finding.bug) : null,
        finding.createdAt,
        finding.updatedAt,
      )
      await this.appendFindingEvent(finding.id, finding.createdAt, finding.bug ? 'reproduced' : 'detected', actor, detail)
    })
  }

  async getFinding(id: string): Promise<FindingRecord | null> {
    const row = await this.get('SELECT * FROM findings WHERE id = $1', id)
    return row ? rowToFinding(row) : null
  }

  async requireFinding(id: string): Promise<FindingRecord> {
    const finding = await this.getFinding(id)
    if (!finding) throw new NotFoundError(`finding ${id}`)
    return finding
  }

  async findingBySignature(repoId: string, signature: string): Promise<FindingRecord | null> {
    const row = await this.get('SELECT * FROM findings WHERE repo_id = $1 AND signature = $2', repoId, signature)
    return row ? rowToFinding(row) : null
  }

  async findingForTask(taskId: string): Promise<FindingRecord | null> {
    const row = await this.get('SELECT * FROM findings WHERE task_id = $1', taskId)
    return row ? rowToFinding(row) : null
  }

  async listFindings(options: { statuses?: readonly FindingStatus[]; repoId?: string; limit?: number } = {}): Promise<FindingRecord[]> {
    const where: string[] = []
    const params: unknown[] = []
    if (options.statuses && options.statuses.length > 0) {
      params.push([...options.statuses])
      where.push(`status = ANY($${params.length})`)
    }
    if (options.repoId) {
      params.push(options.repoId)
      where.push(`repo_id = $${params.length}`)
    }
    params.push(options.limit ?? 100)
    const sql = `SELECT * FROM findings ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT $${params.length}`
    return (await this.all(sql, ...params)).map(rowToFinding)
  }

  /**
   * The only way a finding changes. Locks the row, enforces the status table,
   * bumps the version and appends the event in one transaction.
   */
  async updateFinding(update: FindingUpdate): Promise<FindingRecord> {
    return this.transaction(async () => {
      const row = await this.get('SELECT * FROM findings WHERE id = $1 FOR UPDATE', update.findingId)
      if (!row) throw new NotFoundError(`finding ${update.findingId}`)
      const finding = rowToFinding(row)
      if (update.from && !update.from.includes(finding.status)) {
        throw new DomainError('CONFLICT', `${finding.id} is ${finding.status}, expected ${update.from.join(' or ')}`)
      }
      if (update.to && update.to !== finding.status && !canMoveFinding(finding.status, update.to)) {
        throw new DomainError('CONFLICT', `${finding.id} cannot move from ${finding.status} to ${update.to}`)
      }

      const sets = ['updated_at = $1', 'version = version + 1']
      const values: unknown[] = [update.at]
      if (update.to) {
        values.push(update.to)
        sets.push(`status = $${values.length}`)
      }
      for (const [key, value] of Object.entries(update.patch ?? {}) as [keyof FindingPatch, unknown][]) {
        values.push(value === null || value === undefined ? null : JSON_COLUMNS.has(key) ? toJson(value) : value)
        sets.push(`${FINDING_COLUMNS[key]} = $${values.length}`)
      }
      values.push(finding.id)
      await this.run(`UPDATE findings SET ${sets.join(', ')} WHERE id = $${values.length}`, ...values)
      await this.appendFindingEvent(finding.id, update.at, update.event, update.actor, {
        ...(update.to && update.to !== finding.status ? { from: finding.status, to: update.to } : {}),
        ...update.detail,
      })
      return this.requireFinding(finding.id)
    })
  }

  async appendFindingEvent(
    findingId: string,
    at: number,
    type: FindingEventType,
    actor: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.run(
      'INSERT INTO finding_events (finding_id, at, type, actor, detail_json) VALUES ($1, $2, $3, $4, $5)',
      findingId,
      at,
      type,
      actor,
      toJson(detail),
    )
  }

  async listFindingEvents(findingId: string): Promise<FindingEvent[]> {
    return (await this.all('SELECT * FROM finding_events WHERE finding_id = $1 ORDER BY id ASC', findingId)).map((row) => ({
      id: num(row, 'id'),
      findingId: str(row, 'finding_id'),
      at: num(row, 'at'),
      type: str(row, 'type') as FindingEventType,
      actor: str(row, 'actor'),
      detail: fromJson<Record<string, unknown>>(str(row, 'detail_json')),
    }))
  }

  // ---- bug reports ---------------------------------------------------------

  /** Records an issue the first time it is seen; returns null if it was already tracked. */
  async insertBugReport(report: Omit<BugReportRecord, 'id' | 'seq'>): Promise<BugReportRecord | null> {
    return this.transaction(async () => {
      const next = await this.get('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM bug_reports')
      const seq = next ? num(next, 'next') : 1
      const id = `bug_${String(seq).padStart(3, '0')}`
      const inserted = await this.run(
        `INSERT INTO bug_reports (id, seq, repo_id, issue_number, issue_title, issue_body, issue_url, issue_author, status,
           note, finding_id, reported_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (repo_id, issue_number) DO NOTHING`,
        id,
        seq,
        report.repoId,
        report.issueNumber,
        report.issueTitle,
        report.issueBody,
        report.issueUrl,
        report.issueAuthor,
        report.status,
        report.note,
        report.findingId,
        report.reportedAt,
        report.createdAt,
        report.updatedAt,
      )
      return inserted === 1 ? this.requireBugReport(id) : null
    })
  }

  async getBugReport(id: string): Promise<BugReportRecord | null> {
    const row = await this.get('SELECT * FROM bug_reports WHERE id = $1', id)
    return row ? rowToBugReport(row) : null
  }

  async requireBugReport(id: string): Promise<BugReportRecord> {
    const report = await this.getBugReport(id)
    if (!report) throw new NotFoundError(`bug report ${id}`)
    return report
  }

  async listBugReports(options: { statuses?: readonly BugReportStatus[]; repoId?: string; limit?: number } = {}): Promise<BugReportRecord[]> {
    const where: string[] = []
    const params: unknown[] = []
    if (options.statuses && options.statuses.length > 0) {
      params.push([...options.statuses])
      where.push(`status = ANY($${params.length})`)
    }
    if (options.repoId) {
      params.push(options.repoId)
      where.push(`repo_id = $${params.length}`)
    }
    params.push(options.limit ?? 100)
    const sql = `SELECT * FROM bug_reports ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY reported_at ASC LIMIT $${params.length}`
    return (await this.all(sql, ...params)).map(rowToBugReport)
  }

  /** Moves a report on only from one of the expected statuses, so two runs cannot both settle it. */
  async moveBugReport(
    id: string,
    from: readonly BugReportStatus[],
    to: BugReportStatus,
    at: number,
    patch: { note?: string | null; findingId?: string | null; issueTitle?: string; issueBody?: string } = {},
  ): Promise<BugReportRecord> {
    return this.transaction(async () => {
      const row = await this.get('SELECT * FROM bug_reports WHERE id = $1 FOR UPDATE', id)
      if (!row) throw new NotFoundError(`bug report ${id}`)
      const report = rowToBugReport(row)
      if (!from.includes(report.status)) throw new DomainError('CONFLICT', `${report.id} is ${report.status}, expected ${from.join(' or ')}`)
      await this.run(
        `UPDATE bug_reports SET status = $1, updated_at = $2, note = $3, finding_id = $4, issue_title = $5, issue_body = $6 WHERE id = $7`,
        to,
        at,
        patch.note === undefined ? report.note : patch.note,
        patch.findingId === undefined ? report.findingId : patch.findingId,
        patch.issueTitle ?? report.issueTitle,
        patch.issueBody ?? report.issueBody,
        id,
      )
      return this.requireBugReport(id)
    })
  }
}
