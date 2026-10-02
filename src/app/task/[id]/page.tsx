import { ArrowLeft, CircleDollarSign, Link2, Timer } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AutoRefresh } from '@/components/auto-refresh'
import { ClaimCta } from '@/components/claim-cta'
import { Countdown, LocalTime } from '@/components/clock'
import { CopyButton } from '@/components/copy-button'
import { Reveal } from '@/components/reveal'
import { TASK_STATUS } from '@/lib/format'
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
  const status = TASK_STATUS[task.state]
  const settled = task.state === 'PAID' || task.state === 'REFUNDED'

  return (
    <Reveal>
      {!settled && <AutoRefresh />}
      <section className="bleed stage">
        <div className="stage-media" aria-hidden>
          <img src="/scenes/task-stage.jpg" alt="" />
        </div>
        <div className="detail stage-body">
          <div className="detail-top">
            <Link className="text-link" href="/tasks">
              <ArrowLeft size={14} /> Back to tasks
            </Link>
            <div>
              <span className="label">{task.displayId}</span>
              <span className={`chip ${status.tone}`}>{status.label}</span>
            </div>
          </div>

          <h1>Read this Arc transaction</h1>
          <p>Reply with the recipient address and the USDC amount.</p>

          <div className="hash-field">
            <a className="mono" href={task.explorerTxUrl} target="_blank" rel="noreferrer" title="Open in Arcscan">
              {task.txHash}
            </a>
            <CopyButton value={task.txHash} label="Copy transaction hash" />
          </div>

          <div className="facts">
            <div className="fact">
              <span className="well">
                <CircleDollarSign size={20} />
              </span>
              <div>
                <span>Reward</span>
                <strong>{task.reward} USDC</strong>
              </div>
            </div>
            <div className="fact">
              <span className="well">
                <Timer size={20} />
              </span>
              <div>
                <span>{settled ? 'Settled' : 'Time left'}</span>
                <strong className="tnum">
                  {settled && task.settledAt ? (
                    <LocalTime ts={task.settledAt} />
                  ) : (
                    <Countdown to={task.deadlineAt} done="closing" />
                  )}
                </strong>
              </div>
            </div>
            <div className="fact">
              <span className="well">
                <Link2 size={20} />
              </span>
              <div>
                <span>Chain</span>
                <strong>{task.chain}</strong>
              </div>
            </div>
          </div>

          <ClaimCta task={task} attempts={attempts} />
        </div>
      </section>
    </Reveal>
  )
}
