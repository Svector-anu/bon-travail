import type { Metadata } from 'next'
import Link from 'next/link'
import { AutoRefresh } from '@/components/auto-refresh'
import { Reveal, RevealItem } from '@/components/reveal'
import { TaskRow } from '@/components/task-row'
import { listTaskViews } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Tasks' }

const SETTLED = new Set(['PAID', 'REFUNDED', 'EXPIRED'])

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === 'completed' ? 'completed' : 'live'
  const tasks = listTaskViews(100).filter((t) => (view === 'live' ? !SETTLED.has(t.state) : SETTLED.has(t.state)))
  const firstOpen = tasks.find((t) => t.state === 'OPEN')?.id

  return (
    <Reveal>
      <AutoRefresh />
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p>Machine-checkable work. Real USDC rewards.</p>
        </div>
        <nav className="segmented" aria-label="Filter tasks">
          <Link href="/tasks" aria-current={view === 'live'}>
            Live
          </Link>
          <Link href="/tasks?view=completed" aria-current={view === 'completed'}>
            Completed
          </Link>
        </nav>
      </div>

      {tasks.length === 0 ? (
        <div className="empty">
          {view === 'live' ? 'No live tasks. The agent posts the next one on its next run.' : 'Nothing settled yet.'}
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
