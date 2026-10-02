import type { Metadata } from 'next'
import { AutoRefresh } from '@/components/auto-refresh'
import { Reveal, RevealItem } from '@/components/reveal'
import { TaskRow } from '@/components/task-row'
import { listTaskViews } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Receipts' }

export default function ReceiptsPage() {
  const settled = listTaskViews(100).filter((t) => t.state === 'PAID' || t.state === 'REFUNDED')

  return (
    <Reveal>
      <AutoRefresh everyMs={8000} />
      <div className="page-head">
        <div>
          <h1>Receipts</h1>
          <p>Every paid or refunded task, frozen the moment it settled.</p>
        </div>
      </div>
      {settled.length === 0 ? (
        <div className="empty">No settled tasks yet. The first payout or refund lands here.</div>
      ) : (
        <div className="rows">
          {settled.map((task, i) => (
            <RevealItem key={task.id} index={i}>
              <TaskRow task={task} />
            </RevealItem>
          ))}
        </div>
      )}
    </Reveal>
  )
}
