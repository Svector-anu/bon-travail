import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { INVESTIGABLE, NEEDS_DECISION } from '@/domain/findings'
import type { FindingView } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { Ago, LocalTime } from '@/components/clock'
import { DecisionPanel } from '@/components/decision-panel'
import { Evidence } from '@/components/evidence'
import { ActionButton } from '@/components/owner-actions'
import { Reveal } from '@/components/reveal'
import { FINDING_STATUS, TASK_STATUS } from '@/lib/format'
import { isOwnerSession } from '@/server/owner-session'
import { getFindingDetail } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Finding' }

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
  const inv = finding.investigation
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

      <div className="finding-head">
        <h1>
          {finding.jobName} › {finding.stepName}
        </h1>
        <p className="muted">
          <a href={finding.repoUrl} target="_blank" rel="noreferrer">
            {finding.repo}
          </a>{' '}
          · {finding.workflowName} on {finding.defaultBranch} · first failed <LocalTime ts={finding.firstFailedAt} />
          {finding.recurrenceCount > 0 && ` · came back ${finding.recurrenceCount}×`}
        </p>
      </div>

      {task && (
        <section className="panel in-flight-panel">
          <div className="panel-title">
            <span className="label">Work package {task.displayId}</span>
            <span className={`chip ${TASK_STATUS[task.state].tone}`}>{TASK_STATUS[task.state].label}</span>
          </div>
          <p>
            {task.reward} USDC · open to {task.ci?.contributors.map((c) => `@${c}`).join(', ')}
            {task.claimantHandle && ` · claimed by @${task.claimantHandle}`}
          </p>
          <div className="decision-actions">
            <Link className="btn btn-glass" href={`/task/${task.id}`}>
              Open the work package
            </Link>
            {task.state === 'CLAIMED' && (
              <ActionButton url={`/api/owner/tasks/${task.id}/release-claim`} className="text-link" confirmText="Take the claim back?">
                Release the claim
              </ActionButton>
            )}
          </div>
        </section>
      )}

      <DecisionPanel
        findingId={finding.id}
        canDecide={canDecide}
        canExternalize={canExternalize && !task}
        maxReward={detail.maxReward}
        simulatedPayments={detail.simulatedPayments}
        defaults={defaults(finding)}
      />

      {!finding.investigation && INVESTIGABLE.includes(finding.status) && (
        <p className="notice-line">Aeon picks this up on its next investigation run and attaches what it reproduces.</p>
      )}

      <Evidence
        facts={finding}
        investigation={
          finding.investigation
            ? {
                summary: finding.investigation.summary,
                rootCause: finding.investigation.rootCause,
                firstBadSha: finding.investigation.firstBadSha,
                confidence: finding.investigation.confidence,
                runUrl: finding.investigation.runUrl,
              }
            : null
        }
      />

      {finding.investigation && (
        <section className="panel verification">
          <div className="panel-title">
            <span className="label">How Aeon reproduced it</span>
          </div>
          {finding.investigation.reproduction.length > 0 && (
            <ol className="repro">
              {finding.investigation.reproduction.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
          {finding.investigation.commands.length > 0 && (
            <ul className="commands">
              {finding.investigation.commands.map((c, i) => (
                <li key={i}>
                  <span className={`status ${c.outcome === 'passed' ? 'paid' : c.outcome === 'failed' ? 'refund' : ''}`}>{c.outcome}</span>
                  <code>{c.command}</code>
                  {c.sha && <span className="mono muted">{c.sha.slice(0, 7)}</span>}
                </li>
              ))}
            </ul>
          )}
          {finding.investigation.bisectMethod && <p className="muted">{finding.investigation.bisectMethod}</p>}
        </section>
      )}

      {finding.stepCommand && (
        <section className="panel verification">
          <div className="panel-title">
            <span className="label">Failing step command</span>
          </div>
          <pre className="log">{finding.stepCommand}</pre>
        </section>
      )}

      <section className="panel verification">
        <div className="panel-title">
          <span className="label">Runs and history</span>
        </div>
        <ul className="history">
          {history(finding).map((item, i) =>
            item.kind === 'run' ? (
              <li key={`r${item.run.runId}`}>
                <span className={`status ${item.run.conclusion === 'success' ? 'paid' : 'refund'}`}>{item.run.conclusion}</span>
                <a href={item.run.url} target="_blank" rel="noreferrer">
                  Run #{item.run.runNumber} <ArrowUpRight size={12} />
                </a>
                <span className="mono muted">{item.run.sha.slice(0, 7)}</span>
                <small>
                  <Ago ts={item.at} />
                </small>
              </li>
            ) : (
              <li key={`e${i}`}>
                <span className="status">{actorLabel(item.event.actor)}</span>
                <span>{EVENT_LABELS[item.event.type] ?? item.event.type}</span>
                <span />
                <small>
                  <Ago ts={item.at} />
                </small>
              </li>
            ),
          )}
        </ul>
        {pastTasks.length > 0 && (
          <p className="muted">
            Earlier work packages:{' '}
            {pastTasks.map((t) => (
              <Link key={t.id} href={`/receipt/${t.id}`} style={{ marginRight: 10 }}>
                {t.displayId} ({TASK_STATUS[t.state].label})
              </Link>
            ))}
          </p>
        )}
      </section>
    </Reveal>
  )
}
