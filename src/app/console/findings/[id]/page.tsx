import { ArrowLeft, ArrowUpRight, Check, CircleDashed, Minus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { INVESTIGABLE, investigationIsCurrent, NEEDS_DECISION } from '@/domain/findings'
import type { FindingView } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { Ago, LocalTime } from '@/components/clock'
import { DecisionPanel } from '@/components/decision-panel'
import { CandidateEvidence } from '@/components/candidate-evidence'
import { ActionButton } from '@/components/owner-actions'
import { Reveal } from '@/components/reveal'
import { candidateLabel, preparation } from '@/lib/candidate'
import { FINDING_STATUS, TASK_STATUS } from '@/lib/format'
import { isOwnerSession } from '@/server/owner-session'
import { getFindingDetail } from '@/server/queries'
import { Roll } from '@/components/roll'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Candidate work' }

const EVENT_LABELS: Record<string, string> = {
  detected: 'First failure seen',
  repeated: 'Failed again',
  evidence_gathered: 'Evidence gathered',
  investigated: 'Aeon investigated',
  kept_internal: 'Kept internal',
  externalized: 'Externalized',
  returned: 'Returned after refund',
  resolved: 'Green again',
  recurred: 'Came back',
  dismissed: 'Dismissed',
}

function defaults(finding: FindingView) {
  const inv = investigationIsCurrent(finding) ? finding.investigation : null
  return {
    acceptance:
      inv?.proposedAcceptance ??
      `"${finding.jobName}" in ${finding.workflowName} passes again, without changing the workflow or its tests.`,
    scope:
      inv?.proposedScope ??
      `Find and fix why "${finding.stepName}" fails in the ${finding.jobName} job. Keep the change minimal and inside the code under test.`,
    protectedPaths: inv?.suggestedProtectedPaths ?? [],
    workflowPath: finding.workflowPath,
  }
}

function actorLabel(actor: string): string {
  if (actor.startsWith('aeon')) return 'Aeon'
  if (actor === 'observer' || actor.startsWith('agent')) return 'Observer'
  if (actor === 'owner') return 'You'
  if (actor === 'proofwork') return 'Ledger'
  return actor
}

type HistoryItem =
  | { kind: 'run'; at: number; run: FindingView['runs'][number] }
  | { kind: 'event'; at: number; event: FindingView['events'][number] }

/** Runs and decisions in one timeline, newest first. */
function history(finding: FindingView): HistoryItem[] {
  return [
    ...finding.runs.map((run) => ({ kind: 'run' as const, at: run.at, run })),
    ...finding.events.map((event) => ({ kind: 'event' as const, at: event.at, event })),
  ].sort((a, b) => b.at - a.at)
}

export default async function FindingPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwnerSession())) redirect('/console')
  const detail = await getFindingDetail((await params).id)
  if (!detail) notFound()
  const { finding, task, pastTasks } = detail
  const status = FINDING_STATUS[finding.status]
  const canDecide = NEEDS_DECISION.includes(finding.status)
  const canExternalize = canDecide || finding.status === 'internal'
  const current = investigationIsCurrent(finding)
  const inv = current ? finding.investigation : null
  const prep = preparation(finding)
  const proposal = defaults(finding)
  const timeline = history(finding)

  return (
    <Reveal>
      <AutoRefresh everyMs={10_000} />
      <div className="detail-top">
        <Link className="text-link" href="/console">
          <ArrowLeft size={14} /> Console
        </Link>
        <div>
          <span className="label">{finding.displayId}</span>
          <span className={`chip ${status.tone}`}>{status.label}</span>
        </div>
      </div>

      <header className="cand-head">
        <span className="label">{candidateLabel(finding)}</span>
        <h1>
          {finding.jobName} <span aria-hidden>›</span> {finding.stepName}
        </h1>
        <p className="cand-where">
          <a href={finding.repoUrl} target="_blank" rel="noreferrer">
            {finding.repo}
          </a>{' '}
          · {finding.workflowName} on {finding.defaultBranch}
        </p>
        <dl className="cand-stats">
          <div>
            <dt>Failed in a row</dt>
            <dd className="tnum">{finding.failureCount}</dd>
          </div>
          <div>
            <dt>First seen</dt>
            <dd>
              <Ago ts={finding.firstFailedAt} />
            </dd>
          </div>
          <div>
            <dt>{finding.recurrenceCount > 0 ? 'Came back' : 'Last failed'}</dt>
            <dd className="tnum">{finding.recurrenceCount > 0 ? `${finding.recurrenceCount}×` : <Ago ts={finding.lastFailedAt} />}</dd>
          </div>
        </dl>
      </header>

      <section className="cand-found">
        <div className="cand-finding">
          <span className="label">Aeon found</span>
          {inv ? (
            <>
              <p className="cand-statement">{inv.summary}</p>
              <p className="cand-cause">{inv.rootCause}</p>
              <p className="cand-meta">
                {inv.firstBadSha && (
                  <span>
                    first bad commit <span className="mono">{inv.firstBadSha.slice(0, 7)}</span>
                  </span>
                )}
                <span>{inv.confidence} confidence</span>
                {inv.runUrl && (
                  <a href={inv.runUrl} target="_blank" rel="noreferrer">
                    Aeon&apos;s run <ArrowUpRight size={12} aria-hidden />
                  </a>
                )}
              </p>
            </>
          ) : (
            <p className="cand-statement pending">
              {!INVESTIGABLE.includes(finding.status)
                ? 'This was decided before Aeon investigated it, so the evidence below is what GitHub recorded.'
                : finding.investigation
                  ? 'This failure came back after a fix. Aeon is looking at it again; what it found last time is in the history.'
                  : 'Aeon is investigating. It reruns the failing step in its own runner and attaches what it finds.'}
            </p>
          )}
        </div>
        <aside className="cand-prep" aria-label="What Aeon did before asking you">
          <span className="label">Before asking you, Aeon</span>
          <ul>
            {prep.map((item) => (
              <li key={item.key} className={item.state}>
                {item.state === 'done' ? <Check size={14} aria-hidden /> : item.state === 'pending' ? <CircleDashed size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <CandidateEvidence
        log={finding.errorExcerpt}
        stepCommand={finding.stepCommand}
        failingRunUrl={finding.lastFailedRunUrl}
        reproduction={inv?.reproduction ?? []}
        commands={inv?.commands ?? []}
        bisectMethod={inv?.bisectMethod ?? null}
        regression={finding.regression}
        firstBadSha={inv?.firstBadSha ?? null}
      />

      <section className="cand-accept">
        <span className="label">How a fix is judged</span>
        <blockquote>{proposal.acceptance}</blockquote>
        <p>
          By GitHub Actions on your repository: <strong>{finding.workflowName} › {finding.jobName}</strong> on {finding.defaultBranch}. The person
          fixing it cannot change the workflow, its tests or this condition.
          {!inv && ' Aeon will propose a sharper condition once it has reproduced the failure; you can edit it before approving.'}
        </p>
      </section>

      {task ? (
        <section className="panel in-flight-panel">
          <div className="panel-title">
            <span className="label">Work package {task.displayId}</span>
            <span className={`chip ${TASK_STATUS[task.state].tone}`}>{TASK_STATUS[task.state].label}</span>
          </div>
          <p>
            {task.reward} USDC · open to {task.ci?.contributors.map((c) => `@${c}`).join(', ')}
            {task.claimantHandle && ` · @${task.claimantHandle} is on it`}
          </p>
          <div className="decision-actions">
            <Link className="btn btn-glass" href={`/task/${task.id}`}>
              <Roll>Open the work package</Roll>
            </Link>
            {task.state === 'CLAIMED' && (
              <ActionButton url={`/api/owner/tasks/${task.id}/release-claim`} className="text-link" confirmText="Take the claim back?">
                Release the claim
              </ActionButton>
            )}
          </div>
        </section>
      ) : finding.status === 'resolved' ? (
        <section className="cand-resolved">
          <span className="label">Fixed</span>
          <p>
            Green again{finding.resolvedSha ? <> at <span className="mono">{finding.resolvedSha.slice(0, 7)}</span></> : null}
            {finding.resolvedAt ? (
              <>
                {' '}
                <Ago ts={finding.resolvedAt} />
              </>
            ) : null}
            . Aeon keeps watching; if the same step fails again, it comes back here as a new episode.
          </p>
        </section>
      ) : (
        <DecisionPanel
          findingId={finding.id}
          canDecide={canDecide}
          canExternalize={canExternalize}
          maxReward={detail.maxReward}
          simulatedPayments={detail.simulatedPayments}
          defaults={proposal}
        />
      )}

      {pastTasks.length > 0 && (
        <p className="cand-past muted">
          Earlier work on this failure:{' '}
          {pastTasks.map((t) => (
            <Link key={t.id} href={`/receipt/${t.id}`}>
              {t.displayId} ({TASK_STATUS[t.state].label})
            </Link>
          ))}
        </p>
      )}

      <details className="cand-history">
        <summary>
          History <span className="tnum">· {timeline.length}</span>
        </summary>
        <ul className="history">
          {timeline.map((item, i) =>
            item.kind === 'run' ? (
              <li key={`r${item.run.runId}`}>
                <span className={`status ${item.run.conclusion === 'success' ? 'paid' : 'refund'}`}>{item.run.conclusion}</span>
                <a href={item.run.url} target="_blank" rel="noreferrer">
                  Run #{item.run.runNumber} <ArrowUpRight size={12} />
                </a>
                <span className="mono muted">{item.run.sha.slice(0, 7)}</span>
                <small>
                  <LocalTime ts={item.at} />
                </small>
              </li>
            ) : (
              <li key={`e${i}`}>
                <span className="status">{actorLabel(item.event.actor)}</span>
                <span>{EVENT_LABELS[item.event.type] ?? item.event.type}</span>
                <span />
                <small>
                  <LocalTime ts={item.at} />
                </small>
              </li>
            ),
          )}
        </ul>
      </details>
    </Reveal>
  )
}
