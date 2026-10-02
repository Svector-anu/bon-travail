'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useSyncExternalStore, useTransition, type FormEvent, type ReactNode } from 'react'
import { shortAddress } from '@/domain/address'
import type { AttemptView, TaskView } from '@/domain/views'
import { Countdown } from './clock'
import { connectInjected, hasInjectedWallet, setManualAddress, useWallet } from './wallet'

interface StoredClaim {
  claimId: string
  claimToken: string
  wallet: string
  expiresAt: number
}

const claimKey = (taskId: string) => `proofwork.claim.${taskId}`
const claimListeners = new Set<() => void>()
const claimCache = new Map<string, { raw: string | null; value: StoredClaim | null }>()

function readClaim(taskId: string): StoredClaim | null {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(claimKey(taskId))
  } catch {
    return claimCache.get(taskId)?.value ?? null
  }
  const cached = claimCache.get(taskId)
  if (cached && cached.raw === raw) return cached.value
  let value: StoredClaim | null = null
  try {
    value = raw ? (JSON.parse(raw) as StoredClaim) : null
  } catch {
    value = null
  }
  claimCache.set(taskId, { raw, value })
  return value
}

function saveClaim(taskId: string, claim: StoredClaim) {
  try {
    window.localStorage.setItem(claimKey(taskId), JSON.stringify(claim))
  } catch {
    claimCache.set(taskId, { raw: JSON.stringify(claim), value: claim })
  }
  for (const l of claimListeners) l()
}

function subscribeClaims(listener: () => void) {
  claimListeners.add(listener)
  return () => claimListeners.delete(listener)
}

function useStoredClaim(taskId: string): StoredClaim | null {
  return useSyncExternalStore(
    subscribeClaims,
    () => readClaim(taskId),
    () => null,
  )
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json()) as T & { message?: string }
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`)
  return data
}

const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase())

export function ClaimPanel({ task, attempts }: { task: TaskView; attempts: AttemptView[] }) {
  const router = useRouter()
  const wallet = useWallet()
  const claim = useStoredClaim(task.id)
  const [manual, setManual] = useState('')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<'claiming' | 'submitting' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, startRefresh] = useTransition()
  const [justSubmitted, setJustSubmitted] = useState(false)

  const myAttempt = claim ? attempts.find((a) => a.claimId === claim.claimId) : undefined
  const holdsClaim =
    task.state === 'CLAIMED' && claim !== null && sameAddress(task.claimant, claim.wallet) && !myAttempt
  const answeredBefore = wallet ? attempts.some((a) => sameAddress(a.worker, wallet.address)) : false
  const submitting = busy === 'submitting' || (justSubmitted && refreshing)

  async function claimTask(address: string) {
    setBusy('claiming')
    setError(null)
    try {
      const res = await post<{ claimId: string; claimToken: string; claimExpiresAt: number }>(`/api/tasks/${task.id}/claim`, {
        wallet: address,
      })
      saveClaim(task.id, { claimId: res.claimId, claimToken: res.claimToken, wallet: address, expiresAt: res.claimExpiresAt })
      startRefresh(() => router.refresh())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Claim failed')
    } finally {
      setBusy(null)
    }
  }

  async function onClaim(event: FormEvent) {
    event.preventDefault()
    if (wallet) return claimTask(wallet.address)
    if (!manual.trim()) return setError('Enter the address that should receive the reward.')
    setManualAddress(manual)
    return claimTask(manual.trim())
  }

  async function onConnect() {
    setError(null)
    try {
      const connected = await connectInjected()
      setManual(connected.address)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect')
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!claim) return
    setBusy('submitting')
    setError(null)
    try {
      await post(`/api/tasks/${task.id}/submit`, {
        claimId: claim.claimId,
        claimToken: claim.claimToken,
        recipient,
        amount,
      })
      setJustSubmitted(true)
      startRefresh(() => router.refresh())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
    } finally {
      setBusy(null)
    }
  }

  if (submitting) {
    return (
      <Work title="Checking your answer">
        <ol className="progress" aria-live="polite">
          <li className="done">Answer recorded</li>
          <li className="now">Reading the transaction from Arc</li>
          <li>Paying the reward if it matches</li>
        </ol>
      </Work>
    )
  }

  if (myAttempt?.verification) return <MyVerdict task={task} attempt={myAttempt} />

  switch (task.state) {
    case 'OPEN':
      if (answeredBefore) {
        return (
          <Work title="You already answered this task">
            <p className="work-copy">Each wallet gets one answer per task. Another worker can still claim it.</p>
          </Work>
        )
      }
      return (
        <Work title="Claim it">
          <p className="work-copy">
            Claiming gives you a <strong>10 minute lock</strong> to submit. The reward goes to this address if your answer
            matches the chain.
          </p>
          <form className="work" onSubmit={onClaim}>
            {wallet ? (
              <p className="work-copy">
                Paying to <strong className="mono">{wallet.address}</strong>
              </p>
            ) : (
              <div className="field">
                <label htmlFor="payout">Payout address</label>
                <input
                  id="payout"
                  className="text-input mono-input"
                  placeholder="0x..."
                  autoComplete="off"
                  spellCheck={false}
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                />
              </div>
            )}
            {error && <p className="form-error">{error}</p>}
            <div className="btn-row">
              <button className="btn primary" type="submit" disabled={busy !== null}>
                {busy === 'claiming' ? 'Claiming...' : 'Claim task'}
              </button>
              {!wallet && hasInjectedWallet() && (
                <button className="btn ghost" type="button" onClick={onConnect}>
                  Use browser wallet
                </button>
              )}
            </div>
          </form>
        </Work>
      )

    case 'CLAIMED':
      if (holdsClaim && claim) {
        return (
          <Work title="Submit your answer">
            <p className="work-copy">
              Your lock ends in <strong><Countdown to={claim.expiresAt} done="now" /></strong>. Copy the values exactly as the
              chain shows them.
            </p>
            <form className="work" onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="recipient">1. Recipient address</label>
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
                <div className="input-suffix">
                  <input
                    id="amount"
                    className="text-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    autoComplete="off"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <span>USDC</span>
                </div>
              </div>
              {error && <p className="form-error">{error}</p>}
              <button className="btn primary wide" type="submit" disabled={busy !== null}>
                Submit answer
              </button>
            </form>
          </Work>
        )
      }
      return (
        <Work title="Someone is on it">
          <p className="work-copy">
            Claimed by <strong className="mono">{shortAddress(task.claimant ?? '')}</strong>. If they do not submit, the lock
            frees in <strong>{task.claimExpiresAt ? <Countdown to={task.claimExpiresAt} done="a moment" /> : '--'}</strong> and
            the task reopens.
          </p>
        </Work>
      )

    case 'SUBMITTED':
    case 'VERIFYING':
      return (
        <Work title="Verifying a submission">
          <p className="work-copy">The agent is reading the transaction from Arc and comparing it to the answer.</p>
        </Work>
      )

    case 'ACCEPTED':
      return (
        <Work title="Verified, payout in flight">
          <p className="work-copy">The answer matched. The agent is settling the payout and will retry until it lands.</p>
        </Work>
      )

    case 'REJECTED':
      return (
        <Work title="Last answer did not match">
          <p className="work-copy">The agent reopens this task for other workers on its next sweep.</p>
        </Work>
      )

    case 'PAID':
      return (
        <Work title="Already paid">
          <p className="work-copy">
            Paid to <strong className="mono">{shortAddress(task.claimant ?? '')}</strong>.
          </p>
          <Link className="btn ghost" href={`/receipt/${task.id}`}>
            View receipt
          </Link>
        </Work>
      )

    default:
      return (
        <Work title={task.state === 'REFUNDED' ? 'Expired and refunded' : 'Expired'}>
          <p className="work-copy">Nobody submitted a matching answer before the deadline, so the reward went back to the agent.</p>
          <Link className="btn ghost" href={`/receipt/${task.id}`}>
            View receipt
          </Link>
        </Work>
      )
  }
}

function Work({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="work">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function MyVerdict({ task, attempt }: { task: TaskView; attempt: AttemptView }) {
  const v = attempt.verification!
  const paid = task.state === 'PAID' && sameAddress(task.claimant, attempt.worker)
  return (
    <section className={`verdict ${v.valid ? 'pass' : 'fail'}`} aria-live="polite">
      <h3>{v.valid ? (paid ? `Match. ${task.reward} USDC paid.` : 'Match. Payout settling.') : 'No match'}</h3>
      <p className="work-copy">{v.reason}</p>
      <div className="compare">
        {v.fields.map((f) => (
          <div key={f.field} className="compare-col">
            <div className="compare-field">
              <span>{f.field === 'recipient' ? 'Recipient' : 'Amount'} you sent</span>
              <strong className="mono">{f.field === 'amount' ? `${f.submitted} USDC` : f.submitted}</strong>
            </div>
            <span className={`mark ${f.match ? 'ok' : 'no'}`}>{f.match ? 'Matches chain' : 'Does not match'}</span>
          </div>
        ))}
      </div>
      <div className="btn-row">
        <Link className="btn primary" href={`/receipt/${task.id}`}>
          {paid ? 'Open receipt' : 'View verification'}
        </Link>
      </div>
    </section>
  )
}
