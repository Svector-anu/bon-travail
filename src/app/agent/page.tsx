import type { Metadata } from 'next'
import { ActivityFeed } from '@/components/activity-feed'
import { healthCopy, sourceLabel } from '@/components/agent-strip'
import { AutoRefresh } from '@/components/auto-refresh'
import { Ago, LocalTime } from '@/components/clock'
import { formatDuration } from '@/lib/format'
import { agentActivity } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Agent' }

const HEADLINE = {
  running: 'Running',
  alive: 'Alive',
  error: 'Error',
  stale: 'Stale',
  never: 'Never run',
} as const

export default function AgentPage() {
  const { status, runs } = agentActivity(80)
  const healthy = status.health === 'alive' || status.health === 'running'

  return (
    <div className="page">
      <AutoRefresh everyMs={4000} />
      <img className="hero-mark" src="/mascots/gorilla.png" alt="" />
      <h1>The agent</h1>
      <p className="lede">
        It posts tasks, verifies answers against Arc, pays, reopens and refunds on its own. Every action below is a real
        record.
      </p>

      <section className={`card health ${healthy ? '' : 'muted'}`}>
        <h2>{HEADLINE[status.health]}</h2>
        <p>
          {healthCopy(status.health)}.{' '}
          {status.lastTickAt !== null ? (
            <>
              Last sweep <Ago ts={status.lastTickAt} /> via {sourceLabel(status.lastTickSource)}
              {status.lastTickSummary ? `, ${status.lastTickSummary}` : ''}.
            </>
          ) : (
            'No sweep recorded yet.'
          )}
        </p>
      </section>

      <div className="pair">
        <div className="card stat-card">
          <img src="/mascots/sun.png" alt="" />
          <div className="stat-val tnum">{status.ticksLast24h > 0 ? status.ticksLast24h : '--'}</div>
          <p>Sweeps in the last 24 hours, expected every {formatDuration(status.expectedIntervalMs)}</p>
        </div>
        <div className="card stat-card">
          <img src="/mascots/gift.png" alt="" />
          <div className="stat-val">{status.simulatedPayments ? 'Mock' : 'Arc'}</div>
          <p>
            {status.simulatedPayments
              ? 'Payouts are simulated on a local ledger'
              : 'Payouts are real USDC transfers on Arc Testnet'}
            . Reads from {status.chainReader}.
          </p>
        </div>
      </div>

      <section className="card howto">
        <h2>How it runs without anyone at the keyboard</h2>
        <p>
          An Aeon skill (<code>aeon/skills/proofwork-loop</code>) fires on a cron schedule and calls{' '}
          <code>POST /api/agent/tick</code>. Each sweep expires and refunds overdue tasks, retries stuck verifications and
          payouts, reopens rejected tasks and posts the next one. Worker submissions are verified the moment they arrive; the
          sweep is the safety net.
        </p>
        <p>
          The model never decides who gets paid. Verification is an exact comparison against the chain, and every payout is
          capped per task, per day and by total escrow.
        </p>
        {status.lastSuccessAt !== null && (
          <p>
            Last clean sweep finished at <LocalTime ts={status.lastSuccessAt} full />.
          </p>
        )}
      </section>

      <h2 className="section-title">Activity</h2>
      <ActivityFeed runs={runs} empty="Nothing yet. Run npm run agent:tick, start npm run agent:loop, or schedule the Aeon skill." />
    </div>
  )
}
