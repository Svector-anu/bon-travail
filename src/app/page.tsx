import Link from 'next/link'
import { shortAddress } from '@/domain/address'
import type { TaskView } from '@/domain/views'
import { ActivityFeed } from '@/components/activity-feed'
import { AgentStrip } from '@/components/agent-strip'
import { AutoRefresh } from '@/components/auto-refresh'
import { Countdown } from '@/components/clock'
import { ReceiptRow } from '@/components/receipt-row'
import { StatusPill } from '@/components/status-pill'
import { agentActivity, homeSnapshot, recentReceipts } from '@/server/queries'

export const dynamic = 'force-dynamic'

function LiveTask({ task }: { task: TaskView }) {
  const claimed = task.state === 'CLAIMED' && task.claimant && task.claimExpiresAt
  return (
    <section className="card live-task" aria-label={`Live task ${task.displayId}`}>
      <StatusPill state={task.state} />
      <div className="reward tnum">
        {task.reward}
        <small>USDC</small>
      </div>
      <h2>{task.title}</h2>
      <div className="meta-row">
        <span>
          {task.displayId} on {task.chain}
        </span>
        <span>
          Closes in <strong><Countdown to={task.deadlineAt} done="closing" /></strong>
        </span>
        {claimed ? (
          <span>
            Claimed by <strong>{shortAddress(task.claimant!)}</strong> for{' '}
            <Countdown to={task.claimExpiresAt!} done="a moment" />
          </span>
        ) : (
          <span>
            {task.attemptCount === 0 ? 'No attempts yet' : `${task.attemptCount} attempt${task.attemptCount === 1 ? '' : 's'} so far`}
          </span>
        )}
      </div>
      <Link className="btn primary" href={`/task/${task.id}`}>
        {task.state === 'OPEN' ? 'Do this task' : 'View task'}
      </Link>
    </section>
  )
}

export default function HomePage() {
  const home = homeSnapshot()
  const { status, runs } = agentActivity(6)
  const receipts = recentReceipts(6)
  const [current, ...others] = home.live

  return (
    <div className="page">
      <AutoRefresh />
      <img className="hero-mark lg" src="/mascots/farmer.png" alt="" />
      <h1>Read the chain, get paid</h1>
      <p className="lede">
        An autonomous agent posts small Arc transaction checks. Answer exactly and it pays you USDC, no account needed.
      </p>

      <AgentStrip status={status} />

      {current ? (
        <LiveTask task={current} />
      ) : (
        <div className="card empty" style={{ marginTop: 18 }}>
          No live task right now. The agent posts the next one on its next sweep.
        </div>
      )}

      {others.length > 0 && (
        <div className="stack">
          {others.map((task) => (
            <Link key={task.id} href={`/task/${task.id}`} className="card row-card">
              <div className="row-top">
                <StatusPill state={task.state} />
                <h3>{task.displayId}</h3>
              </div>
              <div className="amount">{task.reward} USDC</div>
              <div className="row-meta">
                <span>{task.title}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="pair">
        <div className="card stat-card">
          <img src="/mascots/gift.png" alt="" />
          <div className="stat-val tnum">{home.paidCount > 0 ? `${home.paidTotal}` : '--'}</div>
          <p>
            USDC paid to workers{home.simulatedPayments && <span className="sim">Simulated</span>}
          </p>
        </div>
        <div className="card stat-card">
          <img src="/mascots/snail.png" alt="" />
          <div className="stat-val tnum">
            {home.paidCount + home.refundedCount > 0 ? `${home.paidCount} / ${home.refundedCount}` : '--'}
          </div>
          <p>Tasks paid / expired and refunded</p>
        </div>
      </div>

      <h2 className="section-title">Receipts</h2>
      {receipts.length > 0 ? (
        <div className="stack">
          {receipts.map((r) => (
            <ReceiptRow key={r.taskId} receipt={r} />
          ))}
        </div>
      ) : (
        <div className="card empty" style={{ marginTop: 16 }}>
          Every paid or refunded task gets a public receipt. The first one lands here.
        </div>
      )}

      <h2 className="section-title">
        What the agent did
        <Link href="/agent">All activity</Link>
      </h2>
      <ActivityFeed runs={runs} empty="The agent has not run yet. Start it with npm run agent:loop or schedule the Aeon skill." />
    </div>
  )
}
