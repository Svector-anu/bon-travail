import type { Metadata } from 'next'
import Link from 'next/link'
import { AutoRefresh } from '@/components/auto-refresh'
import { Reveal, RevealItem } from '@/components/reveal'
import { TaskRow } from '@/components/task-row'
import { listTaskViews } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Paid work' }

const SETTLED = new Set(['PAID', 'REFUNDED', 'EXPIRED'])

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === 'settled' ? 'settled' : 'open'
  const tasks = (await listTaskViews({ limit: 100 })).filter((t) => (view === 'open' ? !SETTLED.has(t.state) : SETTLED.has(t.state)))
  const firstOpen = tasks.find((t) => t.state === 'OPEN')?.id

  return (
    <Reveal>
      <AutoRefresh />
      <div className="page-head">
        <div>
          <h1>paid work</h1>
          <p>Small fixes teams want done. The money is set aside before you start, and it's yours the moment your fix works.</p>
        </div>
        <Link className="text-link" href="/you">
          your earnings →
        </Link>
        <nav className="segmented" aria-label="Filter work">
          <Link href="/tasks" aria-current={view === 'open'}>
            Open
          </Link>
          <Link href="/tasks?view=settled" aria-current={view === 'settled'}>
            Done
          </Link>
        </nav>
      </div>

      {tasks.length === 0 ? (
        <div className="empty">
          {view === 'open'
            ? 'Nothing open right now. New work shows up here the moment a team posts it.'
            : 'Nothing finished yet.'}
        </div>
      ) : (
        <div className="rows">
          {tasks.map((task, i) => (
            <RevealItem key={task.id} index={i}>
              <TaskRow task={task} featured={task.id === firstOpen} />
            </RevealItem>
          ))}
        </div>
      )}
    </Reveal>
  )
}
