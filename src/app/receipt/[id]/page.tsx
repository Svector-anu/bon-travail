import { ArrowLeft, ArrowUpRight, Check, Eye, X } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { shortAddress } from '@/domain/address'
import type { ReceiptView, RecurrenceWatch, TimelineEntry } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { BonTravail } from '@/components/bon-travail'
import { Ago, LocalTime } from '@/components/clock'
import { CopyButton } from '@/components/copy-button'
import { Evidence } from '@/components/evidence'
import { Reveal } from '@/components/reveal'
import { FINDING_STATUS, TASK_STATUS } from '@/lib/format'
import { getApp } from '@/server/container'
import { getReceiptView, recurrenceWatch } from '@/server/queries'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const receipt = await getReceiptView((await params).id)
  if (!receipt) return { title: 'Receipt not found' }
  return { title: `${receipt.task.displayId} ${receipt.outcome.toLowerCase()}`, description: receipt.outcomeReason }
}

const firstAt = (timeline: TimelineEntry[], type: TimelineEntry['type']) => timeline.find((t) => t.type === type)?.at ?? null
const lastAt = (timeline: TimelineEntry[], type: TimelineEntry['type']) => timeline.findLast((t) => t.type === type)?.at ?? null

const REFUND_STEPS: { type: TimelineEntry['type']; label: string }[] = [
  { type: 'created', label: 'Created' },
  { type: 'funded', label: 'Funded' },
  { type: 'published', label: 'Opened' },
  { type: 'expired', label: 'Expired' },
  { type: 'refunded', label: 'Refunded' },
]

const WORK_STEPS: { type: TimelineEntry['type']; label: string }[] = [
  { type: 'created', label: 'Approved' },
  { type: 'funded', label: 'Escrowed' },
  { type: 'claimed', label: 'Claimed' },
  { type: 'submitted', label: 'Submitted' },
  { type: 'accepted', label: 'Verified' },
  { type: 'paid', label: 'Paid' },
]

function Steps({ receipt, steps }: { receipt: ReceiptView; steps: typeof WORK_STEPS }) {
  const final = steps.at(-1)!.type
  return (
    <ol className="htimeline">
      {steps.map((step) => {
        const at = step.type === 'claimed' || step.type === 'submitted' ? lastAt(receipt.timeline, step.type) : firstAt(receipt.timeline, step.type)
        return (
          <li key={step.type} className={at ? (step.type === final ? 'final' : 'done') : ''}>
            <span className="dot" aria-hidden />
            <strong>{step.label}</strong>
            {at ? <LocalTime ts={at} /> : <span className="muted">--</span>}
          </li>
        )
      })}
    </ol>
  )
}

function Seal({ receipt, simulated, url }: { receipt: ReceiptView; simulated: boolean; url: string }) {
  const valid = receipt.attempts.some((a) => a.verification?.valid)
  return (
    <div className="seal">
      {receipt.final ? (
        <>
          <span className="label">Sealed</span>
          {valid && <span className="label">Verified</span>}
          <span className="label">{simulated ? 'Simulated payout' : 'Onchain'}</span>
          <span className="mono">{receipt.digest}</span>
        </>
      ) : (
        <span>Live view. It becomes a permanent receipt when the work settles.</span>
      )}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        Share <CopyButton value={url} label="Copy receipt link" />
      </span>
    </div>
  )
}

function TxLink({ hash, url, simulated = false }: { hash: string | null; url: string | null; simulated?: boolean }) {
  if (!hash) return <span className="muted">{simulated ? 'Reserved in the ledger (simulated)' : '--'}</span>
  if (!url) return <span className="mono">{shortAddress(hash)} (simulated)</span>
  return (
    <a className="mono" href={url} target="_blank" rel="noreferrer">
      {shortAddress(hash)} <ArrowUpRight size={13} />
    </a>
  )
}

function Recurrence({ watch }: { watch: RecurrenceWatch }) {
  const status = FINDING_STATUS[watch.status]
  const back = watch.status === 'recurred'
  return (
    <section className={`panel recurrence ${back ? 'back' : ''}`}>
      <div className="panel-title">
        <span className="label">
          <Eye size={13} aria-hidden /> Recurrence watch · live, not part of the seal
        </span>
        <span className={`chip ${status.tone}`}>{status.label}</span>
      </div>
      <p>
        {back ? (
          <>
            The failure came back
            {watch.lastRecurrenceAt ? (
              <>
                {' '}
                <Ago ts={watch.lastRecurrenceAt} />
              </>
            ) : null}
            . Aeon reopened {watch.findingDisplayId} for the engineering team.
          </>
        ) : watch.status === 'resolved' ? (
          <>
            Green since <span className="mono">{watch.resolvedSha?.slice(0, 7)}</span>:{' '}
            <span className="tnum">{watch.greenRunsSinceFix}</span> passing {watch.greenRunsSinceFix === 1 ? 'run' : 'runs'} on the default branch
            {watch.recurrenceCount > 0 ? `, after ${watch.recurrenceCount} earlier ${watch.recurrenceCount === 1 ? 'recurrence' : 'recurrences'}` : ', no recurrence'}.
          </>
        ) : (
          <>Waiting for the first green run on the default branch.</>
        )}
      </p>
      {watch.lastPolledAt && (
        <small className="muted">
          Last checked <Ago ts={watch.lastPolledAt} />
        </small>
      )}
    </section>
  )
}

async function WorkReceipt({ receipt, watch, url }: { receipt: ReceiptView; watch: RecurrenceWatch | null; url: string }) {
  const { task } = receipt
  const ci = task.ci!
  const paid = receipt.outcome === 'PAID'
  const refunded = receipt.outcome === 'REFUNDED'
  const winning = receipt.attempts.find((a) => a.verification?.valid) ?? receipt.attempts.at(-1) ?? null
  const v = winning?.verification?.kind === 'ci-fix' ? winning.verification : null
  const ev = v?.evidence ?? null
  const payout = receipt.payout
  const simulated = Boolean(payout?.simulated ?? receipt.funding?.simulated)
  const who = receipt.workerHandle ? `@${receipt.workerHandle}` : receipt.worker ? shortAddress(receipt.worker) : null

  return (
    <>
      {paid && who ? (
        <>
          <span className="label">Fix verified · paid</span>
          <div style={{ marginTop: 14 }}>
            <BonTravail size="sm" amount={payout?.amount ?? task.reward} to={who} />
          </div>
          <p className="receipt-sub">{receipt.outcomeReason}</p>
        </>
      ) : (
        <>
          <h1>{refunded ? 'Work refunded' : 'Work in progress'}</h1>
          <p className="receipt-sub">{receipt.outcomeReason}</p>
        </>
      )}

      <div className="receipt-grid">
        <section className="panel">
          <dl className="ledger">
            <dt>Work</dt>
            <dd>{task.title}</dd>
            <dt>Repository</dt>
            <dd>
              <a href={ci.repoUrl} target="_blank" rel="noreferrer">
                {ci.repo} <ArrowUpRight size={13} />
              </a>
            </dd>
            <dt>Reward</dt>
            <dd className="tnum">{task.reward} USDC</dd>
            <dt>Approved by</dt>
            <dd>The engineering team</dd>
            {who && (
              <>
                <dt>Contributor</dt>
                <dd>
                  {who}
                  {receipt.worker && <span className="mono muted"> · {shortAddress(receipt.worker)}</span>}
                </dd>
              </>
            )}
            {ev && (
              <>
                <dt>Pull request</dt>
                <dd>
                  <a href={ev.prUrl} target="_blank" rel="noreferrer">
                    #{ev.prNumber} <ArrowUpRight size={13} />
                  </a>
                </dd>
              </>
            )}
            {ev?.verifiedSha && (
              <>
                <dt>Verified commit</dt>
                <dd className="mono">{ev.verifiedSha.slice(0, 12)}</dd>
              </>
            )}
            {ev?.runUrl && (
              <>
                <dt>Acceptance run</dt>
                <dd>
                  <a href={ev.runUrl} target="_blank" rel="noreferrer">
                    {ev.runConclusion ?? 'run'} <ArrowUpRight size={13} />
                  </a>
                </dd>
              </>
            )}
            <dt>Escrowed</dt>
            <dd>
              <TxLink hash={receipt.funding?.txHash ?? null} url={receipt.funding?.explorerTxUrl ?? null} simulated={receipt.funding?.simulated} />
            </dd>
            <dt>{refunded ? 'Refund' : 'Payout'}</dt>
            <dd>
              <TxLink hash={(payout ?? receipt.refund)?.txHash ?? null} url={(payout ?? receipt.refund)?.explorerTxUrl ?? null} />
            </dd>
          </dl>
        </section>

        <section className={`panel proof-object ${refunded ? 'refund' : ''}`}>
          <img src={refunded ? '/scenes/monolith-refund.jpg' : '/scenes/glass-ring.jpg'} alt="" />
          <strong className="tnum">{(payout ?? receipt.refund)?.amount ?? task.reward} USDC</strong>
          <small>{paid && who ? `Sent to ${who}` : refunded ? 'Back to the treasury' : 'Held in escrow'}</small>
          {simulated && (
            <span className="chip sim" style={{ marginTop: 10 }}>
              Simulated payout
            </span>
          )}
          {(payout ?? receipt.refund ?? receipt.funding)?.explorerTxUrl && (
            <a className="btn btn-glass" href={(payout ?? receipt.refund ?? receipt.funding)!.explorerTxUrl!} target="_blank" rel="noreferrer">
              View on Arcscan <ArrowUpRight size={15} />
            </a>
          )}
        </section>
      </div>

      {v && (
        <section className="panel verification">
          <div className="panel-title">
            <span className="label">Verification · GitHub Actions</span>
            {v.valid ? <Check size={18} className="ok-mark" /> : <X size={18} className="no-mark" />}
          </div>
          <p className="evidence-lead">{v.reason}</p>
          {ev && (
            <dl className="ledger compact">
              <dt>Author</dt>
              <dd>@{ev.author}</dd>
              <dt>Merged</dt>
              <dd>{ev.merged ? 'Yes' : 'No'}</dd>
              <dt>Files checked</dt>
              <dd className="tnum">{ev.filesChecked}</dd>
              <dt>Protected paths</dt>
              <dd>{ev.protectedTouched.length === 0 ? 'Untouched' : ev.protectedTouched.join(', ')}</dd>
              <dt>Acceptance job</dt>
              <dd>
                {ev.jobUrl ? (
                  <a href={ev.jobUrl} target="_blank" rel="noreferrer">
                    {ev.jobName}: {ev.jobConclusion ?? 'pending'} <ArrowUpRight size={13} />
                  </a>
                ) : (
                  `${ev.jobName ?? ci.jobName}: ${ev.jobConclusion ?? 'pending'}`
                )}
              </dd>
            </dl>
          )}
        </section>
      )}

      <section className="panel verification">
        <div className="panel-title">
          <span className="label">Acceptance condition · set by the engineer</span>
        </div>
        <p className="evidence-lead">{ci.acceptance}</p>
        <span className="label" style={{ marginTop: 16, display: 'block' }}>
          Scope
        </span>
        <p className="muted scope">{ci.scope}</p>
      </section>

      {receipt.finding && (
        <section className="verification">
          <Evidence facts={receipt.finding} investigation={receipt.investigation} />
        </section>
      )}

      <section className="panel verification">
        <div className="panel-title">
          <span className="label">Timeline</span>
        </div>
        <Steps receipt={receipt} steps={refunded ? REFUND_STEPS : WORK_STEPS} />
      </section>

      {watch && <Recurrence watch={watch} />}

      <Seal receipt={receipt} simulated={simulated} url={url} />
    </>
  )
}

function RailReceipt({ receipt, url }: { receipt: ReceiptView; url: string }) {
  const { task } = receipt
  const tx = task.tx!
  const paid = receipt.outcome === 'PAID'
  const refunded = receipt.outcome === 'REFUNDED'
  const shown = receipt.attempts.find((a) => a.outcome === 'PASS') ?? receipt.attempts.at(-1) ?? null
  const v = shown?.verification?.kind === 'tx-fact-check' ? shown.verification : null
  const field = (name: string) => v?.fields.find((f) => f.field === name)
  const submitted = shown?.submitted?.kind === 'tx-fact-check' ? shown.submitted : null
  const payout = receipt.payout
  const simulated = Boolean(payout?.simulated ?? receipt.funding?.simulated)
  const settlementTx = payout?.explorerTxUrl ?? receipt.refund?.explorerTxUrl ?? null
  const settledAt = firstAt(receipt.timeline, paid ? 'paid' : 'refunded')
  const verifiedAt = firstAt(receipt.timeline, 'accepted')

  return (
    <>
      {paid && receipt.worker ? (
        <>
          <span className="label">Payment completed</span>
          <div style={{ marginTop: 14 }}>
            <BonTravail size="sm" amount={payout?.amount ?? task.reward} to={shortAddress(receipt.worker)} />
          </div>
          <p className="receipt-sub">The submitted answer matched the onchain data.</p>
        </>
      ) : (
        <>
          <h1>{refunded ? 'Task refunded' : 'In progress'}</h1>
          <p className="receipt-sub">{receipt.outcomeReason}</p>
        </>
      )}

      <div className="receipt-grid">
        <section className="panel">
          <dl className="ledger">
            <dt>Task</dt>
            <dd>Read this Arc transaction (rail test)</dd>
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
              <a className="mono" href={tx.explorerTxUrl} target="_blank" rel="noreferrer">
                {shortAddress(tx.txHash)} <ArrowUpRight size={13} />
              </a>
            </dd>
          </dl>
        </section>

        <section className={`panel proof-object ${refunded ? 'refund' : ''}`}>
          <img src={refunded ? '/scenes/monolith-refund.jpg' : '/scenes/glass-ring.jpg'} alt="" />
          <strong className="tnum">{(payout ?? receipt.refund)?.amount ?? task.reward} USDC</strong>
          <small>
            {paid && receipt.worker ? `Sent to ${shortAddress(receipt.worker)}` : refunded ? 'Back to agent' : 'Reserved for this task'}
          </small>
          {simulated && (
            <span className="chip sim" style={{ marginTop: 10 }}>
              Simulated payout
            </span>
          )}
          <a className="btn btn-glass" href={settlementTx ?? tx.explorerTxUrl} target="_blank" rel="noreferrer">
            {settlementTx ? 'View on block explorer' : 'View task transaction'} <ArrowUpRight size={15} />
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
              {tx.expected ? (
                <>
                  <div className="compare-row">
                    <span>Recipient</span>
                    <span className="mono" style={{ color: 'var(--text)' }}>
                      {tx.expected.recipient}
                    </span>
                  </div>
                  <div className="compare-row">
                    <span>Amount</span>
                    <span className="tnum" style={{ color: 'var(--text)' }}>
                      {tx.expected.amount} USDC
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
                      {name === 'recipient' ? (submitted?.recipient ?? '--') : `${submitted?.amount ?? '--'} USDC`}
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
          <Steps receipt={receipt} steps={REFUND_STEPS} />
        </section>
      )}

      <Seal receipt={receipt} simulated={simulated} url={url} />
    </>
  )
}

export default async function ReceiptPage({ params }: Props) {
  const { id } = await params
  const receipt = await getReceiptView(id)
  if (!receipt) notFound()
  const url = `${(await getApp()).config.publicBaseUrl}/receipt/${id}`
  const watch = receipt.task.ci ? await recurrenceWatch(id) : null
  const status = TASK_STATUS[receipt.outcome]

  return (
    <Reveal className="receipt">
      {(!receipt.final || watch) && <AutoRefresh everyMs={receipt.final ? 30_000 : 8000} />}
      <div className="receipt-head">
        <Link className="text-link" href="/receipts">
          <ArrowLeft size={14} /> Back to receipts
        </Link>
        <div>
          <span className="label">{receipt.task.displayId}</span>
          <span className={`chip ${status.tone}`}>{status.label}</span>
        </div>
      </div>
      {receipt.task.ci ? <WorkReceipt receipt={receipt} watch={watch} url={url} /> : <RailReceipt receipt={receipt} url={url} />}
    </Reveal>
  )
}
