import { ArrowLeft, ArrowUpRight, Check, X } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { shortAddress } from '@/domain/address'
import type { ReceiptView, TimelineEntry } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { LocalTime } from '@/components/clock'
import { CopyButton } from '@/components/copy-button'
import { Reveal } from '@/components/reveal'
import { TASK_STATUS } from '@/lib/format'
import { getApp } from '@/server/container'
import { getReceiptView } from '@/server/queries'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const receipt = getReceiptView((await params).id)
  if (!receipt) return { title: 'Receipt not found' }
  return { title: `${receipt.task.displayId} ${receipt.outcome.toLowerCase()}`, description: receipt.outcomeReason }
}

const firstAt = (timeline: TimelineEntry[], type: TimelineEntry['type']) => timeline.find((t) => t.type === type)?.at ?? null

const REFUND_STEPS: { type: TimelineEntry['type']; label: string }[] = [
  { type: 'created', label: 'Created' },
  { type: 'funded', label: 'Funded' },
  { type: 'published', label: 'Opened' },
  { type: 'expired', label: 'Expired' },
  { type: 'refunded', label: 'Refunded' },
]

function headline(receipt: ReceiptView): { title: string; sub: string } {
  switch (receipt.outcome) {
    case 'PAID':
      return { title: 'Payment completed', sub: 'The submitted answer matched the onchain data.' }
    case 'REFUNDED':
      return { title: 'Task refunded', sub: 'Task expired before an accepted submission.' }
    default:
      return { title: 'In progress', sub: 'This receipt freezes the moment the task is paid or refunded.' }
  }
}

export default async function ReceiptPage({ params }: Props) {
  const receipt = getReceiptView((await params).id)
  if (!receipt) notFound()

  const { task, timeline } = receipt
  const paid = receipt.outcome === 'PAID'
  const refunded = receipt.outcome === 'REFUNDED'
  const status = TASK_STATUS[receipt.outcome]
  const { title, sub } = headline(receipt)
  const shown = receipt.attempts.find((a) => a.outcome === 'PASS') ?? receipt.attempts.at(-1) ?? null
  const v = shown?.verification ?? null
  const field = (name: string) => v?.fields.find((f) => f.field === name)
  const payout = receipt.payout
  const simulated = Boolean(payout?.simulated ?? receipt.funding?.simulated)
  const receiptUrl = `${getApp().config.publicBaseUrl}/receipt/${task.id}`
  const settledAt = firstAt(timeline, paid ? 'paid' : 'refunded')
  const verifiedAt = firstAt(timeline, 'accepted')

  return (
    <Reveal className="receipt">
      {!receipt.final && <AutoRefresh />}
      <div className="receipt-head">
        <Link className="text-link" href="/receipts">
          <ArrowLeft size={14} /> Back to receipts
        </Link>
        <div>
          <span className="label">{task.displayId}</span>
          <span className={`chip ${status.tone}`}>{status.label}</span>
        </div>
      </div>

      <h1>{title}</h1>
      <p className="receipt-sub">{sub}</p>

      <div className="receipt-grid">
        <section className="panel">
          <dl className="ledger">
            <dt>Task</dt>
            <dd>Read this Arc transaction</dd>
            <dt>Reward</dt>
            <dd className="tnum">{task.reward} USDC</dd>
            {receipt.worker && (
              <>
                <dt>Worker</dt>
                <dd className="mono">{shortAddress(receipt.worker)}</dd>
              </>
            )}
            <dt>Posted</dt>
            <dd>
              <LocalTime ts={task.createdAt} full />
            </dd>
            {task.submittedAt && (
              <>
                <dt>Submitted</dt>
                <dd>
                  <LocalTime ts={task.submittedAt} full />
                </dd>
              </>
            )}
            {verifiedAt && (
              <>
                <dt>Verified</dt>
                <dd>
                  <LocalTime ts={verifiedAt} full />
                </dd>
              </>
            )}
            {settledAt && (
              <>
                <dt>{paid ? 'Paid' : 'Refunded'}</dt>
                <dd>
                  <LocalTime ts={settledAt} full />
                </dd>
              </>
            )}
            <dt>Transaction</dt>
            <dd>
              <a className="mono" href={task.explorerTxUrl} target="_blank" rel="noreferrer">
                {shortAddress(task.txHash)} <ArrowUpRight size={13} />
              </a>
            </dd>
          </dl>
        </section>

        <section className={`panel proof-object ${refunded ? 'refund' : ''}`}>
          <img src={refunded ? '/scenes/monolith-refund.jpg' : '/scenes/glass-ring.jpg'} alt="" />
          <strong className="tnum">{(payout ?? receipt.refund)?.amount ?? task.reward} USDC</strong>
          <small>
            {paid && receipt.worker
              ? `Sent to ${shortAddress(receipt.worker)}`
              : refunded
                ? 'Back to agent'
                : 'Reserved for this task'}
          </small>
          {simulated && (
            <span className="chip sim" style={{ marginTop: 10 }}>
              Simulated payout
            </span>
          )}
          <a
            className="btn btn-glass"
            href={payout?.explorerTxUrl ?? task.explorerTxUrl}
            target="_blank"
            rel="noreferrer"
          >
            {payout?.explorerTxUrl ? 'View on block explorer' : 'View task transaction'} <ArrowUpRight size={15} />
          </a>
        </section>
      </div>

      {v && (
        <section className="panel verification">
          <div className="panel-title">
            <span className="label">Verification</span>
            {v.valid ? <Check size={18} className="ok-mark" /> : <X size={18} className="no-mark" />}
          </div>
          <div className="compare">
            <div className="compare-col">
              <h3>Expected (onchain)</h3>
              {task.expected ? (
                <>
                  <div className="compare-row">
                    <span>Recipient</span>
                    <span className="mono" style={{ color: 'var(--text)' }}>
                      {task.expected.recipient}
                    </span>
                  </div>
                  <div className="compare-row">
                    <span>Amount</span>
                    <span className="tnum" style={{ color: 'var(--text)' }}>
                      {task.expected.amount} USDC
                    </span>
                  </div>
                </>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>
                  Revealed when the task settles.
                </p>
              )}
            </div>
            <div className="compare-col">
              <h3>Submission</h3>
              {(['recipient', 'amount'] as const).map((name) => {
                const f = field(name)
                return (
                  <div key={name} className="compare-row">
                    <span>
                      {name === 'recipient' ? 'Recipient' : 'Amount'}
                      {f && <span className={f.match ? 'ok-mark' : 'no-mark'}>{f.match ? 'match' : 'no match'}</span>}
                    </span>
                    <span className={name === 'recipient' ? 'mono' : 'tnum'} style={{ color: 'var(--text)' }}>
                      {name === 'recipient' ? (shown?.submitted?.recipient ?? '--') : `${shown?.submitted?.amount ?? '--'} USDC`}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {refunded && (
        <section className="panel verification">
          <div className="panel-title">
            <span className="label">Timeline</span>
          </div>
          <ol className="htimeline">
            {REFUND_STEPS.map((step) => {
              const at = firstAt(timeline, step.type)
              return (
                <li key={step.type} className={at ? (step.type === 'refunded' ? 'final' : 'done') : ''}>
                  <span className="dot" aria-hidden />
                  <strong>{step.label}</strong>
                  {at ? <LocalTime ts={at} /> : <span className="muted">--</span>}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <div className="seal">
        {receipt.final ? (
          <>
            <span className="label">Settled</span>
            {v?.valid && <span className="label">Verified</span>}
            <span className="label">{simulated ? 'Simulated payout' : 'Onchain'}</span>
            <span className="mono">{receipt.digest}</span>
          </>
        ) : (
          <span>Live view. It becomes a permanent receipt when the task settles.</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          Share <CopyButton value={receiptUrl} label="Copy receipt link" />
        </span>
      </div>
    </Reveal>
  )
}
