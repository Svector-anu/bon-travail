/**
 * A finding is a recurring CI failure the observer found on a watched
 * repository. It is evidence, not work: nothing is paid until an engineer
 * decides to externalize it, which creates a ci-fix task.
 */
export const FINDING_STATUSES = [
  'watching',
  'candidate',
  'investigated',
  'internal',
  'externalized',
  'resolved',
  'recurred',
  'dismissed',
] as const

export type FindingStatus = (typeof FINDING_STATUSES)[number]

const FINDING_TRANSITIONS: Readonly<Record<FindingStatus, readonly FindingStatus[]>> = {
  watching: ['candidate', 'resolved'],
  candidate: ['investigated', 'internal', 'externalized', 'resolved', 'dismissed'],
  investigated: ['investigated', 'internal', 'externalized', 'resolved', 'dismissed'],
  internal: ['externalized', 'resolved'],
  externalized: ['resolved', 'candidate', 'internal'],
  resolved: ['recurred'],
  recurred: ['investigated', 'internal', 'externalized', 'resolved', 'dismissed'],
  dismissed: ['recurred'],
}

/** Statuses where the failure is current and an engineer decision is wanted. */
export const NEEDS_DECISION: readonly FindingStatus[] = ['candidate', 'investigated', 'recurred']

/** Statuses Aeon may attach an investigation to. */
export const INVESTIGABLE: readonly FindingStatus[] = ['candidate', 'investigated', 'recurred']

export function canMoveFinding(from: FindingStatus, to: FindingStatus): boolean {
  return FINDING_TRANSITIONS[from].includes(to)
}

/** Two failures of the same job and step in a row make a finding worth a human's time. */
export const REPEAT_THRESHOLD = 2

export interface RegressionCommit {
  sha: string
  message: string
  author: string | null
  url: string
}

/** Facts computed from GitHub alone, with no model involved. */
export interface RegressionWindow {
  lastGreenSha: string | null
  lastGreenRunUrl: string | null
  firstRedSha: string
  compareUrl: string | null
  commits: RegressionCommit[]
  files: string[]
  truncated: boolean
}

export interface InvestigationCommand {
  command: string
  sha: string | null
  outcome: 'failed' | 'passed' | 'error'
  note: string | null
}

/**
 * An investigation describes one failure episode. Once the failure comes back
 * after a fix, the earlier investigation no longer explains the new one.
 */
export function investigationIsCurrent(finding: { investigation: { submittedAt: number } | null; lastRecurrenceAt: number | null }): boolean {
  return finding.investigation !== null && finding.investigation.submittedAt > (finding.lastRecurrenceAt ?? 0)
}

/**
 * Written by Aeon after reproducing the failure in its own runner. Proofwork
 * stores it as a recommendation; the engineer edits and approves the final
 * acceptance condition and scope.
 */
export interface Investigation {
  author: 'aeon'
  runUrl: string | null
  summary: string
  rootCause: string
  reproduction: string[]
  firstBadSha: string | null
  bisectMethod: string | null
  proposedAcceptance: string
  proposedScope: string
  suggestedProtectedPaths: string[]
  confidence: 'low' | 'medium' | 'high'
  commands: InvestigationCommand[]
  submittedAt: number
}

export interface RepoRecord {
  id: string
  owner: string
  name: string
  defaultBranch: string
  workflowPath: string
  workflowId: number
  workflowName: string
  connectedBy: string
  connectedAt: number
  lastPolledAt: number | null
  active: boolean
  /** Private repositories never appear on public pages. */
  private: boolean
}

export interface WorkflowRunRecord {
  runId: number
  repoId: string
  runNumber: number
  headSha: string
  headBranch: string
  event: string
  conclusion: string
  htmlUrl: string
  runCreatedAt: number
  failingJob: string | null
  failingStep: string | null
  signature: string | null
  findingId: string | null
  observedAt: number
}

/**
 * A finding that started as a bug report rather than a failing run. Aeon
 * wrote a test that fails because of the bug; the fix must add that test
 * unchanged, so the bug's own test is what proves it is fixed.
 */
export interface BugDetails {
  reportId: string
  issueNumber: number
  issueTitle: string
  issueUrl: string
  testPath: string
  testContent: string
  /** sha256 of testContent: the verifier checks the merged file against it. */
  testSha256: string
  testCommand: string
  /** Jobs of the watched workflow that run testCommand: the ones a fix must turn green. Empty means every job. */
  jobs: string[]
  /** The commit Aeon reproduced the bug on. */
  baseSha: string
}

export interface FindingRecord {
  id: string
  seq: number
  repoId: string
  signature: string
  workflowPath: string
  workflowName: string
  jobName: string
  stepName: string
  stepCommand: string | null
  errorExcerpt: string | null
  failureCount: number
  firstFailedRunId: number
  firstFailedSha: string
  firstFailedAt: number
  lastFailedRunId: number
  lastFailedAt: number
  lastFailedRunUrl: string
  regression: RegressionWindow | null
  status: FindingStatus
  investigation: Investigation | null
  decidedBy: string | null
  decidedAt: number | null
  taskId: string | null
  resolvedAt: number | null
  resolvedRunId: number | null
  resolvedSha: string | null
  recurrenceCount: number
  lastRecurrenceAt: number | null
  /** Set when the finding came from a bug report Aeon reproduced; null for CI failures. */
  bug: BugDetails | null
  createdAt: number
  updatedAt: number
  version: number
}

/**
 * An open issue labeled as a bug on a watched repository, waiting for Aeon
 * to reproduce it with a failing test. Once reproduced it becomes a finding.
 */
export const BUG_REPORT_STATUSES = ['reported', 'reproduced', 'not_reproduced', 'closed'] as const
export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number]

/** Issue labels that mark a bug, compared case-insensitively. */
export const BUG_LABELS: readonly string[] = ['bug', 'type: bug', 'type:bug', 'kind/bug', 'bug report']

export interface BugReportRecord {
  id: string
  seq: number
  repoId: string
  issueNumber: number
  issueTitle: string
  issueBody: string
  issueUrl: string
  issueAuthor: string
  status: BugReportStatus
  /** Why Aeon could not reproduce it, for the engineer. */
  note: string | null
  findingId: string | null
  reportedAt: number
  createdAt: number
  updatedAt: number
}

export type FindingEventType =
  | 'detected'
  | 'reproduced'
  | 'repeated'
  | 'evidence_gathered'
  | 'investigated'
  | 'kept_internal'
  | 'externalized'
  | 'returned'
  | 'resolved'
  | 'recurred'
  | 'dismissed'

export interface FindingEvent {
  id: number
  findingId: string
  at: number
  type: FindingEventType
  actor: string
  detail: Record<string, unknown>
}
