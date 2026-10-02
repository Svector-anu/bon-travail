import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AutoRefresh } from '@/components/auto-refresh'
import { ClaimPanel } from '@/components/claim-panel'
import { Countdown, LocalTime } from '@/components/clock'
import { CopyButton } from '@/components/copy-button'
import { StatusPill } from '@/components/status-pill'
import { getTaskDetail } from '@/server/queries'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = getTaskDetail((await params).id)
  return { title: detail ? `${detail.task.displayId}: ${detail.task.reward} USDC` : 'Task not found' }
}

export default async function TaskPage({ params }: Props) {
  const detail = getTaskDetail((await params).id)
  if (!detail) notFound()
  const { task, attempts } = detail
  const settled = task.state === 'PAID' || task.state === 'REFUNDED'

  return (
    <div className="page">
      {!settled && <AutoRefresh />}
      <img className="hero-mark" src="/mascots/duck.png" alt="" />
      <h1>{task.displayId}</h1>
      <p className="lede">
        Posted by the agent <LocalTime ts={task.createdAt} full />. Reward paid automatically when your answer matches the
        chain.
      </p>

      <section className="card task-card">
        <div className="tx-box">
          <span className="label">Arc Testnet transaction</span>
          <span className="hash mono">{task.txHash}</span>
          <div className="tx-actions">
            <a href={task.explorerTxUrl} target="_blank" rel="noreferrer">
              Open in explorer
            </a>
            <CopyButton value={task.txHash} label="Copy hash" />
          </div>
        </div>

        <div className="ask">
          Read this transaction and reply with:
          <ol>
            <li>the recipient address of the USDC transfer</li>
            <li>the exact USDC amount</li>
          </ol>
        </div>

        <dl className="kv">
          <div>
            <dt>Reward</dt>
            <dd className="tnum">{task.reward} USDC</dd>
          </div>
          <div>
            <dt>{settled ? 'Settled' : 'Closes in'}</dt>
            <dd>{settled && task.settledAt ? <LocalTime ts={task.settledAt} /> : <Countdown to={task.deadlineAt} done="closing" />}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusPill state={task.state} />
            </dd>
          </div>
        </dl>

        <hr className="hairline" />

        <ClaimPanel task={task} attempts={attempts} />
      </section>

      <div className="slip-actions">
        <Link className="btn ghost" href={`/receipt/${task.id}`}>
          {settled ? 'Receipt' : 'Live receipt'}
        </Link>
        <Link className="btn ghost" href="/">
          All tasks
        </Link>
      </div>
    </div>
  )
}
