import { ArrowLeft, ArrowUpRight, Check, X } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { shortAddress } from '@/domain/address'
import type { ReceiptView, TimelineEntry } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { BonTravail } from '@/components/bon-travail'
import { LocalTime } from '@/components/clock'
import { CopyButton } from '@/components/copy-button'
import { EvidenceFailure, EvidenceInvestigation } from '@/components/evidence'
import { Reveal } from '@/components/reveal'
import { TASK_STATUS, whoMayTake } from '@/lib/format'
import { getApp } from '@/server/container'
import { getReceiptView } from '@/server/queries'
import { Roll } from '@/components/roll'

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

function ProofSection({ index, label, children }: { index: string; label: string; children: React.ReactNode }) {
  return (
    <section className="proof-section">
      <header>
        <span className="proof-index">{index}</span>
        <span className="label">{label}</span>
      </header>
      <div className="proof-body">{children}</div>
    </section>
  )
}

function WorkReceipt({ receipt, url }: { receipt: ReceiptView; url: string }) {
  const { task } = receipt
  const ci = task.ci!
  const paid = receipt.outcome === 'PAID'
  const refunded = receipt.outcome === 'REFUNDED'
  const winning = receipt.attempts.find((a) => a.verification?.valid) ?? receipt.attempts.at(-1) ?? null
  const v = winning?.verification?.kind === 'ci-fix' ? winning.verification : null
  const ev = v?.evidence ?? null
  const payout = receipt.payout
  const settlement = payout ?? receipt.refund
  const simulated = Boolean(payout?.simulated ?? receipt.funding?.simulated)
  const who = receipt.workerHandle ? `@${receipt.workerHandle}` : receipt.worker ? shortAddress(receipt.worker) : null
  const settledAt = firstAt(receipt.timeline, paid ? 'paid' : 'refunded')

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
          <span className="label">{refunded ? 'Refunded' : 'In progress'}</span>
          <h1>{refunded ? 'nobody finished it in time.' : 'work in progress.'}</h1>
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
            <dt>Posted</dt>
            <dd>
              <LocalTime ts={task.createdAt} full />
            </dd>
            {settledAt && (
              <>
                <dt>{paid ? 'Paid' : 'Refunded'}</dt>
                <dd>
                  <LocalTime ts={settledAt} full />
                </dd>
              </>
            )}
          </dl>
        </section>

        <section className={`panel proof-object ${refunded ? 'refund' : ''}`}>
          <img src={refunded ? '/scenes/monolith-refund.jpg' : '/scenes/glass-ring.jpg'} alt="" />
          <strong className="tnum">{settlement?.amount ?? task.reward} USDC</strong>
          <small>{paid && who ? `Sent to ${who}` : refunded ? 'Back to the treasury' : 'Held in escrow'}</small>
          {simulated && (
            <span className="chip sim" style={{ marginTop: 10 }}>
              Simulated payout
            </span>
          )}
          {(settlement ?? receipt.funding)?.explorerTxUrl && (
            <a className="btn btn-glass" href={(settlement ?? receipt.funding)!.explorerTxUrl!} target="_blank" rel="noreferrer">
              <Roll>
                View on Arcscan <ArrowUpRight size={15} />
              </Roll>
            </a>
          )}
        </section>
      </div>

      <div className="proof">
        {receipt.finding && (
          <ProofSection index="01" label="What failed">
            <EvidenceFailure facts={receipt.finding} />
          </ProofSection>
        )}

        <ProofSection index="02" label="What Aeon found">
          <EvidenceInvestigation investigation={receipt.investigation} />
        </ProofSection>

        <ProofSection index="03" label={paid ? 'What the human did' : 'What was asked'}>
          <div className="proof-panel">
            {who && ev ? (
              <p className="evidence-lead">
                {who} opened{' '}
                <a href={ev.prUrl} target="_blank" rel="noreferrer">
                  pull request #{ev.prNumber} <ArrowUpRight size={13} />
                </a>{' '}
                against {ci.repo}.
              </p>
            ) : (
              <p className="evidence-lead">Open to {whoMayTake(ci)}. Nobody delivered a passing fix before the deadline.</p>
            )}
            <p className="proof-quote">{ci.acceptance}</p>
            <p className="muted scope">{ci.scope}</p>
          </div>
        </ProofSection>

        {v && ev && (
          <ProofSection index="04" label="How it was verified">
            <div className="proof-panel">
              <p className="evidence-lead">
                {v.valid ? <Check size={16} className="ok-mark" /> : <X size={16} className="no-mark" />} {v.reason}
              </p>
              <dl className="ledger compact">
                <dt>Author</dt>
                <dd>@{ev.author}</dd>
                <dt>Merged</dt>
                <dd>{ev.merged ? 'Yes' : 'No'}</dd>
                {ev.verifiedSha && (
                  <>
                    <dt>Commit</dt>
                    <dd className="mono">{ev.verifiedSha.slice(0, 12)}</dd>
                  </>
                )}
                <dt>Protected paths</dt>
                <dd>{ev.protectedTouched.length === 0 ? `Untouched (${ev.filesChecked} files checked)` : ev.protectedTouched.join(', ')}</dd>
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
            </div>
          </ProofSection>
        )}

        <ProofSection index={v && ev ? '05' : '04'} label={refunded ? 'Where the money went' : 'Who got paid · what settled it'}>
          <div className="proof-panel">
            <dl className="ledger compact">
              {paid && who && (
                <>
                  <dt>Paid to</dt>
                  <dd>
                    {who}
                    {receipt.worker && <span className="mono muted"> · {shortAddress(receipt.worker)}</span>}
                  </dd>
                </>
              )}
              {refunded && (
                <>
                  <dt>Returned to</dt>
                  <dd>The team&apos;s treasury</dd>
                </>
              )}
              <dt>Escrowed</dt>
              <dd>
                <TxLink hash={receipt.funding?.txHash ?? null} url={receipt.funding?.explorerTxUrl ?? null} simulated={receipt.funding?.simulated} />
              </dd>
              <dt>{refunded ? 'Refund' : 'Payout'}</dt>
              <dd>
                <TxLink hash={settlement?.txHash ?? null} url={settlement?.explorerTxUrl ?? null} />
              </dd>
              <dt>Rail</dt>
              <dd>{simulated ? 'Simulated ledger' : 'ProofworkEscrow on Arc Testnet'}</dd>
            </dl>
          </div>
        </ProofSection>
      </div>

      <section className="panel verification">
        <div className="panel-title">
          <span className="label">Timeline</span>
        </div>
        <Steps receipt={receipt} steps={refunded ? REFUND_STEPS : WORK_STEPS} />
      </section>


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
            <Roll>{settlementTx ? 'View on block explorer' : 'View task transaction'} <ArrowUpRight size={15} /></Roll>
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
  const status = TASK_STATUS[receipt.outcome]

  return (
    <Reveal className="receipt">
      {!receipt.final && <AutoRefresh everyMs={8000} />}
      <div className="receipt-head">
        <Link className="text-link" href="/receipts">
          <ArrowLeft size={14} /> Back to receipts
        </Link>
        <div>
          <span className="label">{receipt.task.displayId}</span>
          <span className={`chip ${status.tone}`}>{status.label}</span>
        </div>
      </div>
      {receipt.task.ci ? <WorkReceipt receipt={receipt} url={url} /> : <RailReceipt receipt={receipt} url={url} />}
    </Reveal>
  )
}
