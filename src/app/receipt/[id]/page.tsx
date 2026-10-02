import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { AttemptView, PaymentView, ReceiptView } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { LocalTime } from '@/components/clock'
import { CopyButton } from '@/components/copy-button'
import { StatusPill } from '@/components/status-pill'
import { getApp } from '@/server/container'
import { getReceiptView } from '@/server/queries'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

const OUTCOME_WORD: Partial<Record<ReceiptView['outcome'], string>> = {
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
}

const MASCOT: Partial<Record<ReceiptView['outcome'], string>> = {
  PAID: '/mascots/gift.png',
  REFUNDED: '/mascots/snail.png',
  EXPIRED: '/mascots/snail.png',
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const receipt = getReceiptView((await params).id)
  if (!receipt) return { title: 'Receipt not found' }
  return {
    title: `${receipt.task.displayId} ${receipt.outcome.toLowerCase()}`,
    description: `${receipt.task.title}. ${receipt.outcomeReason}`,
  }
}

function PaymentLine({ payment, label }: { payment: PaymentView; label: string }) {
  return (
    <div className="slip-line">
      <span>{label}</span>
      <span>
        {payment.amount} USDC
        {payment.simulated && <span className="sim">Simulated</span>}
      </span>
    </div>
  )
}

function AttemptBlock({ attempt }: { attempt: AttemptView }) {
  const v = attempt.verification
  return (
    <div className="attempt">
      <div className="attempt-top">
        <span className="mono">{attempt.worker}</span>
        <span className={`pill ${attempt.outcome === 'PASS' ? 'live' : attempt.outcome === 'FAIL' ? 'fail' : ''}`}>
          {attempt.outcome === 'PASS' ? 'Match' : attempt.outcome === 'FAIL' ? 'Mismatch' : 'Pending'}
        </span>
      </div>
      {attempt.submitted && (
        <p>
          Sent <span className="mono">{attempt.submitted.recipient}</span> and {attempt.submitted.amount} USDC
          {attempt.submittedAt !== null && (
            <>
              {' '}
              at <LocalTime ts={attempt.submittedAt} full />
            </>
          )}
        </p>
      )}
      {v && <p>{v.reason}</p>}
    </div>
  )
}

export default async function ReceiptPage({ params }: Props) {
  const receipt = getReceiptView((await params).id)
  if (!receipt) notFound()

  const { task } = receipt
  const winner = receipt.attempts.find((a) => a.outcome === 'PASS')
  const shown = winner ?? receipt.attempts.at(-1)
  const others = receipt.attempts.filter((a) => a !== shown)
  const expected = task.expected
  const fields = shown?.verification?.fields ?? []
  const fieldMatch = (name: string) => fields.find((f) => f.field === name)?.match
  const receiptUrl = `${getApp().config.publicBaseUrl}/receipt/${task.id}`
  const settledAmount = receipt.payout ?? receipt.refund

  return (
    <div className="page">
      {!receipt.final && <AutoRefresh />}

      <article className="slip" aria-label={`Receipt for ${task.displayId}`}>
        <header className="slip-head">
          <img src={MASCOT[receipt.outcome] ?? '/mascots/turtle.png'} alt="" />
          <span className="pill">Receipt {task.displayId}</span>
          <div className={`slip-outcome ${receipt.outcome === 'PAID' ? 'paid' : ''}`}>
            {OUTCOME_WORD[receipt.outcome] ?? <StatusPill state={receipt.outcome} />}
          </div>
          <div className="slip-amount tnum">
            {settledAmount?.amount ?? task.reward} USDC
            {settledAmount?.simulated && <span className="sim">Simulated</span>}
          </div>
          <p className="slip-reason">{receipt.outcomeReason}</p>
        </header>

        <section className="slip-section">
          <h2>Task</h2>
          <div className="slip-line">
            <span>Asked</span>
            <span>Read Arc transaction, reply with recipient and USDC amount</span>
          </div>
          <div className="slip-line">
            <span>Transaction</span>
            <a className="mono" href={task.explorerTxUrl} target="_blank" rel="noreferrer">
              {task.txHash}
            </a>
          </div>
          <div className="slip-line">
            <span>Reward</span>
            <span className="tnum">{task.reward} USDC on {task.chain}</span>
          </div>
          <div className="slip-line">
            <span>Posted</span>
            <span>
              <LocalTime ts={task.createdAt} full /> by the agent
            </span>
          </div>
        </section>

        <section className="slip-section">
          <h2>Verification</h2>
          <div className="slip-line">
            <span>Result</span>
            <span>
              {shown?.verification ? (shown.verification.valid ? 'Match' : 'Mismatch') : 'No accepted submission'}
              {shown?.verification && (
                <span className="mono" style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>
                  {receipt.verifier}, block {shown.verification.chainBlock}
                </span>
              )}
            </span>
          </div>
          <div className="compare">
            <div className="compare-col">
              <h3>Expected, from chain</h3>
              {expected ? (
                <>
                  <div className="compare-field">
                    <span>Recipient</span>
                    <strong className="mono">{expected.recipient}</strong>
                  </div>
                  <div className="compare-field">
                    <span>Amount</span>
                    <strong className="tnum">{expected.amount} USDC</strong>
                  </div>
                </>
              ) : (
                <p className="work-copy">Revealed when the task settles so open tasks cannot be copied.</p>
              )}
            </div>
            <div className="compare-col">
              <h3>Submitted{shown ? ` by ${shown.worker.slice(0, 6)}...${shown.worker.slice(-4)}` : ''}</h3>
              {shown?.submitted ? (
                <>
                  <div className="compare-field">
                    <span>
                      Recipient{' '}
                      {fieldMatch('recipient') !== undefined && (
                        <span className={`mark ${fieldMatch('recipient') ? 'ok' : 'no'}`}>
                          {fieldMatch('recipient') ? 'match' : 'no match'}
                        </span>
                      )}
                    </span>
                    <strong className="mono">{shown.submitted.recipient}</strong>
                  </div>
                  <div className="compare-field">
                    <span>
                      Amount{' '}
                      {fieldMatch('amount') !== undefined && (
                        <span className={`mark ${fieldMatch('amount') ? 'ok' : 'no'}`}>
                          {fieldMatch('amount') ? 'match' : 'no match'}
                        </span>
                      )}
                    </span>
                    <strong className="tnum">{shown.submitted.amount} USDC</strong>
                  </div>
                </>
              ) : (
                <p className="work-copy">No submission.</p>
              )}
            </div>
          </div>
          {others.length > 0 && (
            <>
              <h2 style={{ marginTop: 6 }}>Other attempts</h2>
              {others.map((a) => (
                <AttemptBlock key={a.claimId} attempt={a} />
              ))}
            </>
          )}
        </section>

        <section className="slip-section">
          <h2>Payment</h2>
          {receipt.worker && (
            <div className="slip-line">
              <span>Worker</span>
              <span className="mono">{receipt.worker}</span>
            </div>
          )}
          {receipt.funding && <PaymentLine payment={receipt.funding} label="Reserved" />}
          {receipt.payout && <PaymentLine payment={receipt.payout} label="Paid" />}
          {receipt.payout?.txHash && (
            <div className="slip-line">
              <span>Payment tx</span>
              <span>
                {receipt.payout.explorerTxUrl ? (
                  <a className="mono" href={receipt.payout.explorerTxUrl} target="_blank" rel="noreferrer">
                    {receipt.payout.txHash}
                  </a>
                ) : (
                  <span className="mono">{receipt.payout.txHash}</span>
                )}
                {receipt.payout.simulated && (
                  <span style={{ display: 'block', color: 'var(--muted)', fontSize: 13 }}>
                    Mock ledger id. No funds moved on chain.
                  </span>
                )}
              </span>
            </div>
          )}
          {receipt.refund && (
            <div className="slip-line">
              <span>Refunded</span>
              <span>
                {receipt.refund.amount} USDC reservation released back to the agent treasury. Funds never left it, so no
                transfer was needed.
              </span>
            </div>
          )}
          {!receipt.payout && !receipt.refund && (
            <div className="slip-line">
              <span>Status</span>
              <span>Not settled yet</span>
            </div>
          )}
        </section>

        <section className="slip-section">
          <h2>Timeline</h2>
          <ol className="timeline">
            {receipt.timeline.map((entry, i) => (
              <li key={`${entry.at}-${i}`}>
                <span>
                  {entry.label}
                  <span className="actor">{entry.actor.startsWith('worker:') ? 'worker' : entry.actor}</span>
                </span>
                <LocalTime ts={entry.at} full />
              </li>
            ))}
          </ol>
        </section>

        <footer className="slip-foot">
          {receipt.final ? (
            <>
              <span>Frozen at settlement. This receipt can no longer change.</span>
              <span className="mono">{receipt.digest}</span>
            </>
          ) : (
            <span>Live view. It freezes into a permanent receipt when the task is paid or refunded.</span>
          )}
        </footer>
      </article>

      <div className="slip-actions" style={{ marginTop: 34 }}>
        <CopyButton className="btn ghost" value={receiptUrl} label="Copy receipt link" />
        <Link className="btn ghost" href={`/task/${task.id}`}>
          Open task
        </Link>
        <a className="btn ghost" href={task.explorerTxUrl} target="_blank" rel="noreferrer">
          Check the transaction yourself
        </a>
      </div>
    </div>
  )
}
