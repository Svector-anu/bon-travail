'use client'

import { ArrowLeft, ArrowRight, Check, Clock, Lock, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { shortAddress } from '@/domain/address'
import type { AttemptView, TaskView } from '@/domain/views'
import { BonTravail } from './bon-travail'
import { useStoredClaim } from './claim-store'
import { Countdown } from './clock'
import { Roll } from './roll'

const EASE = [0.32, 0.72, 0, 1] as const
const stateMotion = {
  initial: { opacity: 0, y: 16, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(6px)' },
  transition: { duration: 0.5, ease: EASE },
}

interface SubmitResponse {
  task: TaskView
  attempts: AttemptView[]
}

/** Claimed task, one form, then one dramatic but simple verdict. */
export function SubmitMission({ task, attempts }: { task: TaskView; attempts: AttemptView[] }) {
  const router = useRouter()
  const claim = useStoredClaim(task.id)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SubmitResponse | null>(null)

  const liveTask = result?.task ?? task
  const liveAttempts = result?.attempts ?? attempts
  const mine = claim ? liveAttempts.find((a) => a.claimId === claim.claimId) : undefined
  const holdsClaim =
    claim !== null && liveTask.state === 'CLAIMED' && liveTask.claimant?.toLowerCase() === claim.wallet.toLowerCase()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!claim) return
    setVerifying(true)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/${task.id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimId: claim.claimId, claimToken: claim.claimToken, recipient, amount }),
      })
      const data = (await res.json()) as SubmitResponse & { message?: string }
      if (!res.ok) throw new Error(data.message ?? 'Submission failed')
      setResult(data)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
    } finally {
      setVerifying(false)
    }
  }

  let view: 'form' | 'verifying' | 'verified' | 'mismatch' | 'pending' | 'no-claim'
  if (verifying) view = 'verifying'
  else if (mine?.verification) view = mine.verification.valid ? 'verified' : 'mismatch'
  else if (mine?.submittedAt) view = 'pending'
  else if (holdsClaim) view = 'form'
  else view = 'no-claim'

  return (
    <div className="mission-body">
      <div className="detail-top" style={{ margin: 0 }}>
        <Link className="text-link" href={`/task/${task.id}`}>
          <ArrowLeft size={14} /> Back to task
        </Link>
        <div>
          <span className="label">{task.displayId}</span>
          {holdsClaim && <span className="chip claimed">Claimed</span>}
        </div>
      </div>
      <AnimatePresence mode="wait">
        {view === 'form' && claim && (
          <motion.div key="form" {...stateMotion}>
            <h1 style={{ marginTop: 22 }}>Submit your answer</h1>
            <p className="muted" style={{ marginTop: 10 }}>
              Enter the recipient address and USDC amount from the transaction.
            </p>
            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="recipient">Recipient address</label>
                <input
                  id="recipient"
                  className="input mono"
                  placeholder="0x..."
                  autoComplete="off"
                  spellCheck={false}
                  required
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="amount">USDC amount</label>
                <input
                  id="amount"
                  className="input tnum"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                />
              </div>
              <div className="lock-row">
                <Lock size={14} />
                <span>Your claim is locked for you</span>
                <span className="tnum">
                  <Clock size={13} /> <Countdown to={claim.expiresAt} done="0s" />
                </span>
              </div>
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="btn btn-primary btn-wide">
                <Roll>Submit answer <ArrowRight size={16} /></Roll>
              </button>
              <a className="text-link" href={task.tx?.explorerTxUrl} target="_blank" rel="noreferrer" style={{ justifySelf: 'center' }}>
                Open the transaction on Arcscan <ArrowRight size={13} />
              </a>
            </form>
          </motion.div>
        )}

        {view === 'verifying' && (
          <motion.div key="verifying" className="verdict-state" {...stateMotion}>
            <motion.div
              className="verdict-word wait"
              animate={{ opacity: [1, 0.45, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              Verifying...
            </motion.div>
            <p>Reading the transaction from Arc and comparing it to your answer.</p>
          </motion.div>
        )}

        {(view === 'verified' || view === 'mismatch') && mine?.verification && (
          <motion.div key={view} className="verdict-state" {...stateMotion}>
            {view === 'verified' && liveTask.state === 'PAID' ? (
              <BonTravail amount={liveTask.reward} to={shortAddress(mine.worker)} />
            ) : (
              <>
                <div className={`verdict-word ${view === 'verified' ? 'ok' : 'no'}`}>
                  {view === 'verified' ? 'Verified' : 'Not a match'}
                </div>
                <p>{view === 'verified' ? 'Your answer matched. The payout is settling.' : mine.verification.reason}</p>
              </>
            )}
            <div className="field-checks">
              {(mine.verification.kind === 'tx-fact-check' ? mine.verification.fields : []).map((f) => (
                <div key={f.field} className="field-check">
                  {f.match ? <Check size={16} className="ok" /> : <X size={16} className="no" />}
                  <span className="muted">{f.field === 'recipient' ? 'Recipient' : 'Amount'}</span>
                  <span className="mono">{f.field === 'amount' ? `${f.submitted} USDC` : f.submitted}</span>
                </div>
              ))}
            </div>
            <Link className="btn btn-primary" href={view === 'verified' ? `/receipt/${task.id}` : '/tasks'}>
              <Roll>{view === 'verified' ? 'View receipt' : 'Back to tasks'} <ArrowRight size={16} /></Roll>
            </Link>
          </motion.div>
        )}

        {view === 'pending' && (
          <motion.div key="pending" className="verdict-state" {...stateMotion}>
            <div className="verdict-word wait">Verifying...</div>
            <p>Your answer is recorded. The agent will finish verifying on its next run.</p>
          </motion.div>
        )}

        {view === 'no-claim' && (
          <motion.div key="no-claim" className="verdict-state" {...stateMotion}>
            <h1>Claim this task first</h1>
            <p>You need an active claim lock to submit an answer.</p>
            <Link className="btn btn-primary" href={`/task/${task.id}`} style={{ marginTop: 24 }}>
              <Roll>Go to {task.displayId} <ArrowRight size={16} /></Roll>
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
