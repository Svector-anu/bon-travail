import { ArrowRight, ArrowUpRight, GitBranch } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { FindingSummaryView } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { Ago } from '@/components/clock'
import { CheckNow, ConnectRepo, GithubMark, OwnerLogin, SignOut, WatchRepo } from '@/components/owner-actions'
import { Reveal } from '@/components/reveal'
import { FINDING_STATUS, TASK_STATUS } from '@/lib/format'
import { getApp } from '@/server/container'
import { ownerActor } from '@/server/owner-session'
import { consoleSnapshot } from '@/server/queries'

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
        {finding.repo} · failed <span className="tnum">{finding.failureCount}</span>× · last <Ago ts={finding.lastFailedAt} />
        {finding.recurrenceCount > 0 && ` · came back ${finding.recurrenceCount}×`}
        {finding.investigated && ' · Aeon investigated'}
      </small>
      {extra}
      <ArrowRight size={16} className="go" aria-hidden />
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
      <AutoRefresh everyMs={10_000} />
      <div className="page-head">
        <div>
          <h1>Console</h1>
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
          <div className="rows">
            {snapshot.needsDecision.map((f) => (
              <FindingRow key={f.id} finding={f} />
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
        {snapshot.installable.map((repo) => (
          <WatchRepo key={repo.slug} slug={repo.slug} isPrivate={repo.private} />
        ))}
        {snapshot.githubError && <p className="form-error">GitHub: {snapshot.githubError}</p>}
        {snapshot.installUrl ? (
          <a className="btn btn-glass connect-github" href={snapshot.installUrl}>
            <GithubMark /> {snapshot.repos.length + snapshot.installable.length === 0 ? 'Connect GitHub' : 'Add or remove repositories on GitHub'}
          </a>
        ) : (
          <ConnectRepo />
        )}
        <p className="muted console-note">
          Read-only: Bon Travail can read workflow runs, logs and pull requests on the repositories you choose. It never writes to them.
        </p>
      </section>

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
