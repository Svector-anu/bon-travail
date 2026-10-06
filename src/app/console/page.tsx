import { ArrowRight, ArrowUpRight, GitBranch } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { FindingSummaryView } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { Ago } from '@/components/clock'
import { CheckNow, ConnectRepo, GithubMark, OwnerLogin, SignOut, WatchPicker } from '@/components/owner-actions'
import { Reveal } from '@/components/reveal'
import { SignedInHint } from '@/components/signed-in-hint'
import { candidateLabel } from '@/lib/candidate'
import { FINDING_STATUS, TASK_STATUS } from '@/lib/format'
import { getApp } from '@/server/container'
import { OWNER_SESSION_MS } from '@/server/owner'
import { ownerActor } from '@/server/owner-session'
import { consoleSnapshot } from '@/server/queries'
import { Roll } from '@/components/roll'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Console' }

function FindingRow({ finding, extra }: { finding: FindingSummaryView; extra?: React.ReactNode }) {
  const status = FINDING_STATUS[finding.status]
  return (
    <Link href={`/console/findings/${finding.id}`} className="finding-row">
      <span className={`status ${status.tone}`}>{status.label}</span>
      <span className="id">{finding.displayId}</span>
      <strong>
        {finding.jobName} › {finding.stepName}
      </strong>
      <small>
        {finding.isBug ? (
          <>
            {finding.repo} · reported bug, reproduced by Aeon <Ago ts={finding.firstFailedAt} />
          </>
        ) : (
          <>
            {finding.repo} · failed <span className="tnum">{finding.failureCount}</span>× · last <Ago ts={finding.lastFailedAt} />
            {finding.recurrenceCount > 0 && ` · came back ${finding.recurrenceCount}×`}
            {finding.investigated && ' · Aeon investigated'}
          </>
        )}
      </small>
      {extra}
      <ArrowRight size={16} className="go" aria-hidden />
    </Link>
  )
}

/** A candidate waiting on the engineer: what failed, and what Aeon already worked out. */
function CandidateCard({ finding }: { finding: FindingSummaryView }) {
  return (
    <Link href={`/console/findings/${finding.id}`} className="cand-card">
      <span className="label">{candidateLabel(finding)}</span>
      <h3>
        {finding.jobName} <span aria-hidden>›</span> {finding.stepName}
      </h3>
      <p className="cand-card-where">
        {finding.isBug ? (
          <>
            {finding.repo} · Aeon wrote a test that fails because of it <Ago ts={finding.firstFailedAt} />
          </>
        ) : (
          <>
            {finding.repo} · failed <span className="tnum">{finding.failureCount}</span> in a row · first seen <Ago ts={finding.firstFailedAt} />
            {finding.recurrenceCount > 0 && ` · came back ${finding.recurrenceCount}×`}
          </>
        )}
      </p>
      <p className={finding.investigationSummary ? 'cand-card-found' : 'cand-card-found pending'}>
        {finding.investigationSummary ? (
          <>
            <span className="label">Aeon found</span> {finding.investigationSummary}
          </>
        ) : (
          'Aeon is investigating: rerunning the step, narrowing the commits, drafting how a fix should be judged.'
        )}
      </p>
      <span className="cand-card-go">
        Review <ArrowRight size={14} aria-hidden />
      </span>
    </Link>
  )
}

export default async function ConsolePage({ searchParams }: { searchParams: Promise<{ error?: string; login?: string }> }) {
  const actor = await ownerActor()
  if (!actor) {
    const { error, login } = await searchParams
    const { config } = await getApp()
    return (
      <Reveal>
        <OwnerLogin error={error ?? null} login={login ?? null} enabled={Boolean(config.githubApp && config.ownerGithubLogins.length > 0)} />
      </Reveal>
    )
  }
  const snapshot = await consoleSnapshot()

  return (
    <Reveal>
      <SignedInHint maxAgeSeconds={OWNER_SESSION_MS / 1000} />
      <AutoRefresh everyMs={10_000} />
      <div className="page-head">
        <div>
          <h1>console</h1>
          <p>What your agents found, and what you decided. Nothing leaves the team until you approve it.</p>
        </div>
        <div className="signed-in">
          {actor.startsWith('github:') && <span className="muted">@{actor.slice('github:'.length)}</span>}
          <SignOut />
        </div>
      </div>

      {!snapshot.githubEnabled && (
        <p className="notice-line">GITHUB_TOKEN is not configured, so repositories cannot be watched in this environment.</p>
      )}
      <p className="console-mode muted">
        Payments: {snapshot.simulatedPayments ? 'simulated (no USDC moves)' : `${snapshot.paymentProvider} on Arc Testnet`}
      </p>

      <section className="console-section">
        <div className="panel-title">
          <span className="label">Needs your decision</span>
          <span className="label tnum">{snapshot.needsDecision.length}</span>
        </div>
        {snapshot.needsDecision.length === 0 ? (
          <p className="muted">Nothing is failing repeatedly. Aeon keeps watching.</p>
        ) : (
          <div className="cand-cards">
            {snapshot.needsDecision.map((f) => (
              <CandidateCard key={f.id} finding={f} />
            ))}
          </div>
        )}
      </section>

      {snapshot.inFlight.length > 0 && (
        <section className="console-section">
          <div className="panel-title">
            <span className="label">In flight</span>
          </div>
          <div className="rows">
            {snapshot.inFlight.map(({ finding, task }) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                extra={
                  task ? (
                    <small className="in-flight">
                      {task.displayId} · {TASK_STATUS[task.state].label}
                      {task.claimantHandle ? ` · @${task.claimantHandle}` : ''} · {task.reward} USDC
                    </small>
                  ) : null
                }
              />
            ))}
          </div>
        </section>
      )}

      <section className="console-section">
        <div className="panel-title">
          <span className="label">Repositories</span>
        </div>
        {snapshot.repos.map((repo) => (
          <div key={repo.id} className="repo-row">
            <GitBranch size={16} aria-hidden />
            <div>
              <a href={repo.url} target="_blank" rel="noreferrer">
                {repo.slug} <ArrowUpRight size={13} />
              </a>
              <small>
                Watching {repo.workflowName} (<span className="mono">{repo.workflowPath}</span>) on {repo.defaultBranch}
                {repo.lastPolledAt ? (
                  <>
                    {' '}
                    · checked <Ago ts={repo.lastPolledAt} />
                  </>
                ) : null}
              </small>
            </div>
            <CheckNow repoId={repo.id} />
          </div>
        ))}
        {snapshot.installable.length > 0 && <WatchPicker repos={snapshot.installable} />}
        {snapshot.githubError && <p className="form-error">GitHub: {snapshot.githubError}</p>}
        {snapshot.installUrl ? (
          <a className="btn btn-glass connect-github" href={snapshot.installUrl}>
            <Roll><GithubMark /> {snapshot.repos.length + snapshot.installable.length === 0 ? 'Connect GitHub' : 'Add or remove repositories on GitHub'}</Roll>
          </a>
        ) : (
          <ConnectRepo />
        )}
        <p className="muted console-note">
          Read-only: bon travail can read workflow runs, logs, issues and pull requests on the repositories you choose. It never writes to them.
          Label an issue <span className="mono">bug</span> and Aeon turns it into a failing test you can pay a human to fix.
        </p>
      </section>

      {snapshot.bugsWaiting.length > 0 && (
        <section className="console-section">
          <div className="panel-title">
            <span className="label">Bugs waiting for Aeon</span>
            <span className="label tnum">{snapshot.bugsWaiting.length}</span>
          </div>
          <div className="rows">
            {snapshot.bugsWaiting.map((bug) => (
              <a key={bug.id} href={bug.issueUrl} target="_blank" rel="noreferrer" className="finding-row">
                <span className="status">{bug.status === 'reported' ? 'Reproducing' : 'Not reproduced'}</span>
                <span className="id">#{bug.issueNumber}</span>
                <strong>{bug.issueTitle}</strong>
                <small>
                  {bug.repo} · reported <Ago ts={bug.reportedAt} />
                  {bug.status === 'reported'
                    ? ' · Aeon writes a test that fails because of it on its next pass'
                    : bug.note
                      ? ` · Aeon: ${bug.note}`
                      : ''}
                </small>
                <ArrowUpRight size={16} className="go" aria-hidden />
              </a>
            ))}
          </div>
        </section>
      )}

      {(snapshot.watching.length > 0 || snapshot.settled.length > 0) && (
        <section className="console-section">
          <div className="panel-title">
            <span className="label">Watching and settled</span>
          </div>
          <div className="rows">
            {[...snapshot.watching, ...snapshot.settled].map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
          </div>
        </section>
      )}
    </Reveal>
  )
}
