import { ArrowRight, Lock, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AgentJourney, type JourneyStop } from '@/components/agent-journey'
import { AutoRefresh } from '@/components/auto-refresh'
import { Ago } from '@/components/clock'
import { ActionButton } from '@/components/owner-actions'
import { Reveal } from '@/components/reveal'
import { consoleViewer } from '@/server/owner-session'
import { agentActivity, agentPipeline, consoleSnapshot, type AgentPipeline } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Agent' }

const HEADLINE = {
  running: 'aeon is working.',
  alive: 'aeon is watching.',
  error: 'aeon needs a look.',
  stale: 'aeon is watching.',
  never: 'aeon has not started.',
} as const

const STATE_WORD = {
  running: 'working',
  alive: 'observing',
  error: 'needs attention',
  stale: 'between sweeps',
  never: 'not started',
} as const

const SOURCE = { aeon: 'Aeon', 'local-loop': 'local loop', manual: 'manual run', cron: 'Vercel cron' } as Record<string, string>

const stage = (pipeline: AgentPipeline, key: string) => pipeline.stages.find((s) => s.key === key)?.count ?? 0

/** The loop in three moments: everything Aeon has found, what humans are fixing now, and everyone paid. */
function journey(pipeline: AgentPipeline): JourneyStop[] {
  return [
    {
      key: 'investigating',
      count: pipeline.found,
      unit: 'found',
      title: 'Aeon finds it',
      copy: 'When the same test breaks twice, Aeon works out why.',
    },
    {
      key: 'humans',
      count: stage(pipeline, 'open') + stage(pipeline, 'assigned') + stage(pipeline, 'verifying'),
      unit: 'with humans now',
      title: 'A human fixes it',
      copy: 'You choose who, and the money is set aside first.',
    },
    { key: 'paid', count: stage(pipeline, 'paid'), unit: 'paid', title: 'Your tests pay them', copy: 'The moment the fix works, they are paid in USDC.' },
  ]
}

/** What the "currently" band says when there is no decision for this visitor to make. Counts only, so it is safe in public. */
function publicNow(pipeline: AgentPipeline): { title: string; detail: string; href: string; cta: string } {
  const deciding = stage(pipeline, 'investigating') + stage(pipeline, 'awaiting')
  const withHumans = stage(pipeline, 'open') + stage(pipeline, 'assigned') + stage(pipeline, 'verifying')
  if (deciding > 0)
    return {
      title: deciding === 1 ? 'Repeated failure detected' : `${deciding} repeated failures detected`,
      detail: 'Your team decides whether a human should fix it.',
      href: '/console',
      cta: 'Review in the console',
    }
  if (withHumans > 0)
    return {
      title: withHumans === 1 ? 'A fix is with a human' : `${withHumans} fixes are with humans`,
      detail: 'They are paid the moment the fix works.',
      href: '/tasks',
      cta: 'See the work',
    }
  return {
    title: 'Nothing is failing repeatedly',
    detail: 'Aeon speaks up when the same test breaks twice.',
    href: '/receipts',
    cta: 'See what it has settled',
  }
}

export default async function AgentPage() {
  const viewer = await consoleViewer().catch(() => null)
  // Full agent detail is for operators; team members see their own candidates in the console.
  const [{ status }, pipeline, snapshot] = await Promise.all([
    agentActivity(1, {}, viewer?.operator ? 'owner' : 'public'),
    agentPipeline(),
    viewer ? consoleSnapshot(viewer) : null,
  ])
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
          <p>It watches your code and finds what keeps breaking.</p>
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

      <section className="journey-section" aria-labelledby="journey-title">
        <header className="journey-head">
          <span className="label">The loop</span>
          <h2 id="journey-title">From broken code to a paid fix</h2>
        </header>
        <AgentJourney stops={journey(pipeline)} />
      </section>

    </Reveal>
  )
}
