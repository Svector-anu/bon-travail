import type { Metadata } from 'next'
import Link from 'next/link'
import { shortAddress } from '@/domain/address'
import { AutoRefresh } from '@/components/auto-refresh'
import { LocalTime } from '@/components/clock'
import { formatDuration } from '@/lib/format'
import { recentReceipts } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Receipts' }

export default function ReceiptsPage() {
  const receipts = recentReceipts(50)

  return (
    <section className="page">
      <AutoRefresh everyMs={8000} />
      <img className="hero-mark" src="/mascots/gift.png" alt="" />
      <h1>Receipts</h1>
      <p className="lede">Every paid or refunded task, frozen the moment it settled.</p>

      {receipts.length === 0 ? (
        <div className="tvl-card">
          <h2 className="ink">--</h2>
          <p>No settled tasks yet. The first payout or refund lands here.</p>
        </div>
      ) : (
        <div className="proposal-list">
          {receipts.map((r) => {
            const paid = r.outcome === 'PAID'
            const window = Math.max(1, r.deadlineAt - r.postedAt)
            const used = Math.min(100, Math.max(2, ((r.settledAt - r.postedAt) / window) * 100))
            return (
              <Link key={r.taskId} href={`/receipt/${r.taskId}`} className="proposal">
                <div className="proposal-top">
                  <span className={paid ? 'pill paid' : 'pill'}>{paid ? 'Paid' : 'Refunded'}</span>
                  <span className="mono">{r.displayId}</span>
                </div>
                <h2>
                  {r.reward} USDC {paid && r.worker ? `to ${shortAddress(r.worker)}` : 'back to the agent'}
                  {r.simulated && <span className="sim">Simulated</span>}
                </h2>
                <div className="bar" aria-label={`Settled after ${Math.round(used)}% of the task window`}>
                  <div className="bar-fill" style={{ width: `${used}%` }} />
                </div>
                <div className="proposal-meta">
                  <span>
                    Settled {formatDuration(r.settledAt - r.postedAt)} after posting
                  </span>
                  <LocalTime ts={r.settledAt} full />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
