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
import { Reveal } from '@/components/reveal'
import { TASK_STATUS } from '@/lib/format'
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

interface StoryLine {
  word: string
  text: string
  href: string | null
  where: string
  at: number | null
  tone?: 'final' | 'refund'
}

/** The whole receipt in five plain lines: what broke, what Aeon found, who fixed it, what proved it, where the money went. */
function storyLines(
  receipt: ReceiptView,
  ctx: {
    paid: boolean
    refunded: boolean
    who: string | null
    ev: { prUrl: string; prNumber: number; verifiedSha: string | null; jobUrl: string | null } | null
    settlement: { amount: string; explorerTxUrl: string | null } | null
  },
): StoryLine[] {
  const { task, finding, investigation } = receipt
  const ci = task.ci!
  const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '')
  const firstBad = investigation?.firstBadSha ?? finding?.regression?.firstRedSha ?? finding?.firstFailedSha ?? null
  const lines: StoryLine[] = [
    {
      word: 'Broke',
      text: `"${finding?.stepName ?? ci.jobName}" started failing${firstBad ? ` at ${short(firstBad)}` : ''}.`,
      href: finding?.lastFailedRunUrl ?? null,
      where: 'the run',
      at: finding?.firstFailedAt ?? null,
    },
    {
      word: 'Found',
      text: investigation ? (investigation.firstBadSha ? `Aeon traced it to one commit, ${short(investigation.firstBadSha)}.` : 'Aeon reproduced it.') : 'GitHub recorded the failing step.',
      href: investigation?.runUrl ?? null,
      where: "Aeon's run",
      at: null,
    },
  ]
  if (ctx.ev && ctx.who) {
    lines.push({ word: 'Fixed', text: `${ctx.who} fixed it in pull request #${ctx.ev.prNumber}.`, href: ctx.ev.prUrl, where: 'GitHub', at: lastAt(receipt.timeline, 'submitted') })
    lines.push({
      word: 'Proved',
      text: `Your tests passed on ${ci.baseBranch}${ctx.ev.verifiedSha ? ` at ${short(ctx.ev.verifiedSha)}` : ''}.`,
      href: ctx.ev.jobUrl,
      where: 'the check',
      at: firstAt(receipt.timeline, 'accepted'),
    })
  }
  if (ctx.paid) {
    lines.push({
      word: 'Paid',
      text: `${ctx.settlement?.amount ?? task.reward} USDC to ${ctx.who ?? 'the contributor'}.`,
      href: ctx.settlement?.explorerTxUrl ?? null,
      where: 'Arcscan',
      at: firstAt(receipt.timeline, 'paid'),
      tone: 'final',
    })
  } else if (ctx.refunded) {
    lines.push({
      word: 'Refunded',
      text: `Nobody finished in time; ${ctx.settlement?.amount ?? task.reward} USDC went back to the team.`,
      href: ctx.settlement?.explorerTxUrl ?? null,
      where: 'Arcscan',
      at: firstAt(receipt.timeline, 'refunded'),
      tone: 'refund',
    })
  }
  return lines
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

      <ol className="rstory" aria-label="What happened">
        {storyLines(receipt, { paid, refunded, who, ev, settlement }).map((line) => (
          <li key={line.word} className={line.tone}>
            <span className="rstory-word">{line.word}</span>
            <p>
              {line.text}{' '}
              {line.href && (
                <a href={line.href} target="_blank" rel="noreferrer" aria-label={`${line.word}: open on ${line.where}`}>
                  {line.where} <ArrowUpRight size={13} aria-hidden />
                </a>
              )}
            </p>
            {line.at ? <LocalTime ts={line.at} /> : <span />}
          </li>
        ))}
      </ol>

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
