'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'
import { shortAddress } from '@/domain/address'
import type { AttemptView, TaskView } from '@/domain/views'
import { saveClaim, useStoredClaim, type StoredClaim } from './claim-store'
import { Countdown } from './clock'
import { Sheet } from './sheet'
import { pushToast } from './toasts'
import { connectInjected, hasInjectedWallet, setManualAddress, useWallet } from './wallet'

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json()) as T & { message?: string }
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`)
  return data
}

interface SubmitResponse {
  task: TaskView
  attempts: AttemptView[]
}

const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase())

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

/** Turnip "work" recipe for one task: notice, hero metric, stat pair, sheets. */
export function TaskWork({ task, attempts }: { task: TaskView; attempts: AttemptView[] }) {
  const router = useRouter()
  const wallet = useWallet()
  const claim = useStoredClaim(task.id)
  const [, startRefresh] = useTransition()
  const [sheet, setSheet] = useState<'claim' | 'submit' | null>(null)
  const [noticeHidden, setNoticeHidden] = useState(false)

  const myAttempt = claim ? attempts.find((a) => a.claimId === claim.claimId) : undefined
  const holdsClaim = task.state === 'CLAIMED' && claim !== null && sameAddress(task.claimant, claim.wallet) && !myAttempt
  const answeredBefore = wallet ? attempts.some((a) => sameAddress(a.worker, wallet.address)) : false
  const settled = task.state === 'PAID' || task.state === 'REFUNDED'
  const iWasPaid = task.state === 'PAID' && myAttempt?.outcome === 'PASS'

  const refresh = () => startRefresh(() => router.refresh())

  return (
    <>
      {!noticeHidden && (
        <div className="notice with-x">
          <img src="/mascots/droplet.png" alt="" />
          <p>
            Open <span className="mono">{shortAddress(task.txHash)}</span> on Arcscan and read who received USDC and how much.
          </p>
          <a className="text-action" href={task.explorerTxUrl} target="_blank" rel="noreferrer">
            Open in explorer
          </a>
          <button type="button" className="icon-x" aria-label="Dismiss" onClick={() => setNoticeHidden(true)}>
            <XIcon />
          </button>
        </div>
      )}

      <div className="tvl-card">
        <h2 className="tnum">{task.reward} USDC</h2>
        <p>
          <HeroCaption task={task} />
        </p>
      </div>

      <div className="pair">
        <article className="card stat-card">
          <img src="/mascots/seedling.png" alt="" />
          <div className="stat-val tnum">
            {holdsClaim && claim ? (
              <Countdown to={claim.expiresAt} done="--" />
            ) : task.state === 'CLAIMED' && task.claimant ? (
              shortAddress(task.claimant)
            ) : (
              '--'
            )}
          </div>
          <p>{holdsClaim ? 'Your claim lock' : task.state === 'CLAIMED' ? 'Claimed by another worker' : 'Claim lock, 10 minutes'}</p>
          <div className="stat-actions">
            <a className="btn ghost" href={task.explorerTxUrl} target="_blank" rel="noreferrer">
              Read tx
            </a>
            {holdsClaim ? (
              <button type="button" className="btn primary" onClick={() => setSheet('submit')}>
                Submit answer
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={task.state !== 'OPEN' || answeredBefore}
                onClick={() => setSheet('claim')}
              >
                {answeredBefore ? 'Answered' : 'Claim task'}
              </button>
            )}
          </div>
        </article>

        <article className="card stat-card">
          <img src="/mascots/gift.png" alt="" />
          <div className="stat-val tnum">{iWasPaid ? task.reward : '--'}</div>
          <p>{rewardCaption(task, myAttempt)}</p>
          <Link className="btn ghost wide" href={`/receipt/${task.id}`}>
            {settled ? 'View receipt' : 'Live receipt'}
          </Link>
        </article>
      </div>

      {myAttempt?.verification && <Verdict task={task} attempt={myAttempt} />}

      {sheet === 'claim' && (
        <ClaimSheet
          task={task}
          walletAddress={wallet?.address ?? null}
          onClose={() => setSheet(null)}
          onClaimed={() => {
            pushToast(`Claimed ${task.displayId}. Lock started.`)
            setSheet('submit')
            refresh()
          }}
        />
      )}
      {sheet === 'submit' && claim && (
        <SubmitSheet
          task={task}
          claim={claim}
          onClose={() => setSheet(null)}
          onDone={(res) => {
            const mine = res.attempts.find((a) => a.claimId === claim.claimId)
            if (res.task.state === 'PAID' && mine?.outcome === 'PASS') pushToast(`Match. ${task.reward} USDC paid.`)
            else if (mine?.outcome === 'FAIL') pushToast('No match. See what differed below.')
            else pushToast('Answer recorded. The agent will finish verifying shortly.')
            setSheet(null)
            refresh()
          }}
        />
      )}
    </>
  )
}

function HeroCaption({ task }: { task: TaskView }) {
  switch (task.state) {
    case 'OPEN':
      return (
        <>
          Reward. Closes in <Countdown to={task.deadlineAt} done="a moment" />
        </>
      )
    case 'CLAIMED':
      return (
        <>
          Claimed. Lock frees in <Countdown to={task.claimExpiresAt ?? task.deadlineAt} done="a moment" />
        </>
      )
    case 'SUBMITTED':
    case 'VERIFYING':
      return <>Verifying an answer against Arc</>
    case 'ACCEPTED':
      return <>Verified. Payout settling</>
    case 'PAID':
      return <>Paid to {shortAddress(task.claimant ?? '')}</>
    case 'REJECTED':
      return <>Last answer did not match. Reopening</>
    default:
      return <>Expired with no match. Refunded to the agent</>
  }
}

function rewardCaption(task: TaskView, mine: AttemptView | undefined): string {
  if (mine?.outcome === 'PASS') return task.state === 'PAID' ? 'Paid to you' : 'Earned, payout settling'
  if (mine?.outcome === 'FAIL') return 'Your answer did not match'
  if (task.state === 'PAID') return 'Paid to another worker'
  return 'Your reward'
}

function ClaimSheet({
  task,
  walletAddress,
  onClose,
  onClaimed,
}: {
  task: TaskView
  walletAddress: string | null
  onClose: () => void
  onClaimed: () => void
}) {
  const [address, setAddress] = useState(walletAddress ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function useWalletAddress() {
    setError(null)
    try {
      setAddress((await connectInjected()).address)
    } catch (e) {
      setError(errorText(e, 'Could not connect'))
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const wallet = address.trim()
    if (!wallet) return setError('Enter the address that should receive the reward.')
    setBusy(true)
    setError(null)
    try {
      const res = await post<{ claimId: string; claimToken: string; claimExpiresAt: number }>(`/api/tasks/${task.id}/claim`, {
        wallet,
      })
      if (!walletAddress) setManualAddress(wallet)
      saveClaim(task.id, { claimId: res.claimId, claimToken: res.claimToken, wallet, expiresAt: res.claimExpiresAt })
      onClaimed()
    } catch (e) {
      setError(errorText(e, 'Claim failed'))
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Claim ${task.displayId}`} onClose={onClose}>
      <p className="modal-copy">
        You get a <strong>10 minute lock</strong> to answer. The reward goes to this address if your answer matches the chain.
      </p>
      <form className="work" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="payout">Payout address</label>
          <div className="amount-box">
            <input
              id="payout"
              className="mono"
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              style={{ fontSize: 14, fontWeight: 600 }}
            />
            {hasInjectedWallet() && (
              <button type="button" className="max-btn" onClick={useWalletAddress}>
                Wallet
              </button>
            )}
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Claiming...' : 'Claim task'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

function SubmitSheet({
  task,
  claim,
  onClose,
  onDone,
}: {
  task: TaskView
  claim: StoredClaim
  onClose: () => void
  onDone: (res: SubmitResponse) => void
}) {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone(
        await post<SubmitResponse>(`/api/tasks/${task.id}/submit`, {
          claimId: claim.claimId,
          claimToken: claim.claimToken,
          recipient,
          amount,
        }),
      )
    } catch (e) {
      setError(errorText(e, 'Submission failed'))
      setBusy(false)
    }
  }

  return (
    <Sheet title="Submit your answer" onClose={busy ? () => undefined : onClose}>
      <form className="work" onSubmit={onSubmit}>
        <div className="field">
          <div className="field-row">
            <label htmlFor="recipient">1. Recipient address</label>
            <span>
              Lock ends in <Countdown to={claim.expiresAt} done="now" />
            </span>
          </div>
          <input
            id="recipient"
            className="text-input mono-input"
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
            required
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="amount">2. USDC amount</label>
          <div className="amount-box">
            <input
              id="amount"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            />
            <span className="max-btn">USDC</span>
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Verifying on Arc...' : 'Submit answer'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

function Verdict({ task, attempt }: { task: TaskView; attempt: AttemptView }) {
  const v = attempt.verification!
  return (
    <section className={`card verdict ${v.valid ? 'pass' : 'fail'}`} style={{ marginTop: 18, textAlign: 'left' }} aria-live="polite">
      <h3>{v.valid ? (task.state === 'PAID' ? `Match. ${task.reward} USDC paid.` : 'Match. Payout settling.') : 'No match'}</h3>
      <p className="work-copy">{v.reason}</p>
      <div className="compare">
        {v.fields.map((f) => (
          <div key={f.field} className="compare-col">
            <div className="compare-field">
              <span>{f.field === 'recipient' ? 'Recipient you sent' : 'Amount you sent'}</span>
              <strong className="mono">{f.field === 'amount' ? `${f.submitted} USDC` : f.submitted}</strong>
            </div>
            <span className={`mark ${f.match ? 'ok' : 'no'}`}>{f.match ? 'Matches chain' : 'Does not match'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M3.2 3.2a.8.8 0 0 1 1.1 0L8 6.9l3.7-3.7a.8.8 0 0 1 1.1 1.1L9.1 8l3.7 3.7a.8.8 0 1 1-1.1 1.1L8 9.1l-3.7 3.7a.8.8 0 1 1-1.1-1.1L6.9 8 3.2 4.3a.8.8 0 0 1 0-1.1z"
        fill="currentColor"
      />
    </svg>
  )
}
