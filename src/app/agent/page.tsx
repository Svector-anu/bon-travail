import { ArrowRight, Lock, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ActivityTimeline } from '@/components/activity-timeline'
import { AutoRefresh } from '@/components/auto-refresh'
import { Ago } from '@/components/clock'
import { ActionButton } from '@/components/owner-actions'
import { Reveal } from '@/components/reveal'
import { isOwnerSession } from '@/server/owner-session'
import { agentActivity, agentPipeline, consoleSnapshot, type AgentPipeline } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Agent' }

const HEADLINE = {
  running: 'aeon is working.',
  alive: 'aeon is watching.',
  error: 'aeon needs a look.',
  stale: 'aeon is resting.',
  never: 'aeon has not started.',
} as const

const STATE_WORD = {
  running: 'working',
  alive: 'observing',
  error: 'needs attention',
  stale: 'offline',
  never: 'not started',
} as const

const SOURCE = { aeon: 'Aeon', 'local-loop': 'local loop', manual: 'manual run', cron: 'Vercel cron' } as Record<string, string>

const stage = (pipeline: AgentPipeline, key: string) => pipeline.stages.find((s) => s.key === key)?.count ?? 0

/** What the "currently" band says when there is no decision for this visitor to make. Counts only, so it is safe in public. */
function publicNow(pipeline: AgentPipeline): { title: string; detail: string; href: string; cta: string } {
  const deciding = stage(pipeline, 'investigating') + stage(pipeline, 'awaiting')
  const withHumans = stage(pipeline, 'open') + stage(pipeline, 'assigned') + stage(pipeline, 'verifying')
  if (deciding > 0)
    return {
      title: deciding === 1 ? 'Repeated failure detected' : `${deciding} repeated failures detected`,
      detail: 'Waiting on the engineering team to keep it internal or hand it to a human.',
      href: '/console',
      cta: 'Review in the console',
    }
  if (withHumans > 0)
    return {
      title: withHumans === 1 ? 'A fix is with a human' : `${withHumans} fixes are with humans`,
      detail: 'Aeon re-checks the tests and settles the moment they pass.',
      href: '/tasks',
      cta: 'See the work',
    }
  return {
    title: 'Nothing is failing repeatedly',
    detail: `${pipeline.runsObserved} runs read. Aeon flags a failure the second time the same step breaks.`,
    href: '/receipts',
    cta: 'See what it has settled',
  }
}

export default async function AgentPage() {
  const owner = await isOwnerSession().catch(() => false)
  const [{ status, runs }, pipeline, snapshot] = await Promise.all([agentActivity(30, {}, owner ? 'owner' : 'public'), agentPipeline(), owner ? consoleSnapshot() : null])
  const visible = runs.filter((r) => r.action !== 'source_task' || r.result !== 'skipped')
  // The engineer sees the actual failure and can decide from here; everyone else sees counts.
  const candidate = snapshot?.needsDecision[0] ?? null
  const now = publicNow(pipeline)

  return (
    <Reveal>
      <AutoRefresh everyMs={8000} />
      <section className="agent-hero">
        <div className="agent-hero-copy">
          <span className="label">Agent</span>
          <h1>{HEADLINE[status.health]}</h1>
          <p>Watching your code, finding what breaks, and getting it ready for a human to fix.</p>
          <ul className="agent-status">
            <li>
              <span className={`presence-dot ${status.health}`} aria-hidden />
              <strong>{STATE_WORD[status.health]}</strong>
            </li>
            <li>
              <span className="tnum">{pipeline.reposWatched}</span> {pipeline.reposWatched === 1 ? 'repository' : 'repositories'}
            </li>
            <li>
              {status.lastTickAt !== null ? (
                <>
                  last sweep <Ago ts={status.lastTickAt} />
                  {status.lastTickSource && status.lastTickSource !== 'aeon' ? ` via ${SOURCE[status.lastTickSource] ?? status.lastTickSource}` : ''}
                </>
              ) : (
                'waiting for its first sweep'
              )}
            </li>
          </ul>
        </div>

        <div className="agent-now">
          <div>
            <span className="label">Currently</span>
            {candidate ? (
              <>
                <h2>Repeated failure detected</h2>
                <p className="agent-now-repo">{candidate.repo}</p>
                <p className="agent-now-meta">
                  {candidate.jobName} › {candidate.stepName} · <span className="tnum">{candidate.failureCount}</span> failed runs · first seen{' '}
                  <Ago ts={candidate.firstFailedAt} />
                </p>
              </>
            ) : (
              <>
                <h2>{now.title}</h2>
                <p className="agent-now-meta">{now.detail}</p>
              </>
            )}
          </div>
          <div className="agent-now-actions">
            {candidate ? (
              <>
                <ActionButton url={`/api/owner/findings/${candidate.id}/internal`} className="agent-choice light">
                  Keep internal <Lock size={18} aria-hidden />
                </ActionButton>
                <Link className="agent-choice" href={`/console/findings/${candidate.id}#decide`}>
                  Externalize work <Users size={18} aria-hidden />
                </Link>
              </>
            ) : (
              <Link className="agent-choice" href={now.href}>
                {now.cta} <ArrowRight size={18} aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="pipeline" aria-label="Where the work stands">
        <p className="pipeline-scope">
          Watching <strong className="tnum">{pipeline.reposWatched}</strong> {pipeline.reposWatched === 1 ? 'repository' : 'repositories'} ·{' '}
          <strong className="tnum">{pipeline.runsObserved}</strong> runs read
        </p>
        <ol className="pipeline-stages">
          {pipeline.stages.map((s) => (
            <li key={s.key} className={s.count > 0 ? 'active' : ''}>
              <strong className="tnum">{s.count}</strong>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="agent-log">
        <span className="label">Everything it did</span>
        <div className="panel" style={{ padding: '6px 0', marginTop: 14 }}>
          <ActivityTimeline runs={visible} />
        </div>
      </section>

      <p className="label" style={{ marginTop: 22 }}>
        {status.simulatedPayments ? 'Simulated payouts' : 'Arc Testnet escrow payouts'} · scheduled by Aeon · expected every{' '}
        {Math.round(status.expectedIntervalMs / 60000)} min
      </p>
    </Reveal>
  )
}
