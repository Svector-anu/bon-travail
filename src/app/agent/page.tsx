import type { Metadata } from 'next'
import { ActivityTimeline } from '@/components/activity-timeline'
import { AutoRefresh } from '@/components/auto-refresh'
import { Ago } from '@/components/clock'
import { Reveal } from '@/components/reveal'
import { agentActivity } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Agent' }

const PRESENCE = {
  running: 'Running',
  alive: 'Online',
  error: 'Needs attention',
  stale: 'Offline',
  never: 'Not started',
} as const

const SOURCE = { aeon: 'Aeon', 'local-loop': 'local loop', manual: 'manual run' } as Record<string, string>

export default function AgentPage() {
  const { status, runs } = agentActivity(24)
  const visible = runs.filter((r) => r.action !== 'source_task' || r.result !== 'skipped')

  return (
    <Reveal>
      <AutoRefresh everyMs={4000} />
      <div className="agent-head">
        <div>
          <h1>Agent</h1>
          <p>Autonomous execution. Transparent activity.</p>
        </div>
        <div className="presence">
          <span className={`presence-dot ${status.health}`} aria-hidden />
          <div>
            <strong>{PRESENCE[status.health]}</strong>
            <small>
              {status.lastTickAt !== null ? (
                <>
                  Last run <Ago ts={status.lastTickAt} />
                  {status.lastTickSource ? ` via ${SOURCE[status.lastTickSource] ?? status.lastTickSource}` : ''}
                </>
              ) : (
                'Waiting for its first run'
              )}
            </small>
          </div>
        </div>
      </div>

      <div className="agent-body">
        <section className="panel" style={{ padding: '6px 0' }}>
          <ActivityTimeline runs={visible} />
        </section>
        <div className="agent-scene" aria-hidden>
          <img src="/scenes/monolith-tall.jpg" alt="" />
        </div>
      </div>

      <p className="label" style={{ marginTop: 22 }}>
        {status.simulatedPayments ? 'Simulated payouts' : 'Arc Testnet payouts'} · reads {status.chainReader} · expected every{' '}
        {Math.round(status.expectedIntervalMs / 60000)} min
      </p>
    </Reveal>
  )
}
