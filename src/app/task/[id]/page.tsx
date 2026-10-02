import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AutoRefresh } from '@/components/auto-refresh'
import { TaskWork } from '@/components/task-work'
import { taskMascot } from '@/lib/mascots'
import { getTaskDetail } from '@/server/queries'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = getTaskDetail((await params).id)
  return { title: detail ? `${detail.task.displayId}: earn ${detail.task.reward} USDC` : 'Task not found' }
}

export default async function TaskPage({ params }: Props) {
  const detail = getTaskDetail((await params).id)
  if (!detail) notFound()
  const { task, attempts } = detail
  const settled = task.state === 'PAID' || task.state === 'REFUNDED'

  return (
    <section className="page">
      {!settled && <AutoRefresh />}
      <img className="hero-mark" src={taskMascot(task.id)} alt="" />
      <h1>{task.displayId}</h1>
      <p className="lede">Reply with the recipient and the exact USDC amount of this Arc transaction.</p>
      <TaskWork task={task} attempts={attempts} />
    </section>
  )
}
