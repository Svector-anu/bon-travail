import type { Metadata } from 'next'
import { AutoRefresh } from '@/components/auto-refresh'
import { Reveal, RevealItem } from '@/components/reveal'
import { Pager } from '@/components/pager'
import { TaskRow } from '@/components/task-row'
import { listReceiptPage } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Receipts' }

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const list = await listReceiptPage(Number((await searchParams).page ?? 1))
  const settled = list.items

  return (
    <Reveal>
      <AutoRefresh everyMs={8000} />
      <div className="page-head">
        <div>
          <h1>receipts</h1>
          <p>Every payment, with proof of what was fixed and why it was paid. Refunds too.</p>
        </div>
      </div>
      {settled.length === 0 ? (
        <div className="empty">Nothing paid yet. The first payment shows up here.</div>
      ) : (
        <div className="rows">
          {settled.map((task, i) => (
            <RevealItem key={task.id} index={i}>
              <TaskRow task={task} />
            </RevealItem>
          ))}
        </div>
      )}
      <Pager page={list.page} pageSize={list.pageSize} total={list.total} href={(page) => `/receipts?page=${page}`} />
    </Reveal>
  )
}
