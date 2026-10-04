'use client'

import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, GitPullRequest, LoaderCircle, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { AttemptView, TaskView } from '@/domain/views'
import { whoMayTake } from '@/lib/format'
import { Roll } from './roll'

interface Props {
  task: TaskView
  attempts: AttemptView[]
  claimedPrUrl: string | null
  waitingFor: string | null
  lastError: string | null
}

async function post(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(data.message ?? `Request failed (${res.status})`)
  }
}

/**
 * The contributor's side of a work package. There is no sign-in: the pull
 * request itself proves who is working, and the server checks it against the
 * engineer's allowlist on GitHub before anything is recorded.
 */
export function WorkPanel({ task, attempts, claimedPrUrl, waitingFor, lastError }: Props) {
  const router = useRouter()
  const ci = task.ci!
  const [prUrl, setPrUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastVerdict = attempts.at(-1)?.verification ?? null

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setError(null)
    try {
      await fn()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  function onClaim(event: FormEvent) {
    event.preventDefault()
    void run('claim', () => post(`/api/work/${task.id}/claim`, { prUrl: prUrl.trim() }))
  }

  let body
  if (task.state === 'PAID' || task.state === 'REFUNDED' || task.state === 'EXPIRED') {
    body = (
      <Link className="btn btn-primary btn-wide" href={`/receipt/${task.id}`}>
        <Roll>View receipt <ArrowRight size={16} /></Roll>
      </Link>
    )
  } else if (task.state === 'DRAFT' || task.state === 'FUNDED') {
    body = <p className="work-state">The team approved this. The money is being set aside now.</p>
  } else if (task.state === 'OPEN') {
    body = (
      <form onSubmit={onClaim} className="work-form">
        {lastVerdict && !lastVerdict.valid && (
          <p className="work-state refund">Last attempt failed: {lastVerdict.reason} You can push a fix and claim again.</p>
        )}
        <div className="field">
          <label htmlFor="pr-url">Your pull request</label>
          <input
            id="pr-url"
            className="input mono"
            placeholder={`${ci.repoUrl}/pull/123`}
            autoComplete="off"
            spellCheck={false}
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-wide" disabled={busy !== null || prUrl.trim().length === 0}>
          <Roll>{busy === 'claim' ? 'Checking the PR on GitHub...' : 'Claim with this PR'}
          {busy !== 'claim' && <GitPullRequest size={16} />}</Roll>
        </button>
        <p className="work-hint">
          Open a PR against <span className="mono">{ci.baseBranch}</span> that mentions <strong>{task.displayId}</strong> and has a line{' '}
          <span className="mono">Payout: 0x…</span> with your wallet.{' '}
          {ci.openToAnyone ? 'Anyone on GitHub can take it; a claim holds for a day.' : `Only ${whoMayTake(ci)} can claim it.`}
        </p>
      </form>
    )
  } else if (task.state === 'CLAIMED') {
    body = (
      <div className="work-form">
        <p className="work-state">
          <strong>@{task.claimantHandle}</strong> is working on it
          {claimedPrUrl && (
            <>
              {' in '}
              <a href={claimedPrUrl} target="_blank" rel="noreferrer">
                {claimedPrUrl.replace(/^https:\/\/github\.com\//, '')}
              </a>
            </>
          )}
          .
        </p>
        {claimedPrUrl && (
          <button
            type="button"
            className="btn btn-primary btn-wide"
            disabled={busy !== null}
            onClick={() => void run('submit', () => post(`/api/work/${task.id}/submit`, { prUrl: claimedPrUrl }))}
          >
            <Roll>{busy === 'submit' ? 'Sending it to the tests...' : 'Done: check my fix'}
            {busy !== 'submit' && <ArrowRight size={16} />}</Roll>
          </button>
        )}
        <p className="work-hint">
          {ci.requireMerge
            ? `Payout needs the fix merged into ${ci.baseBranch} and "${ci.jobName}" green there. A maintainer decides the merge.`
            : `Payout needs "${ci.jobName}" green on the PR head.`}
        </p>
      </div>
    )
  } else {
    const verifying = task.state === 'SUBMITTED' || task.state === 'VERIFYING'
    body = (
      <div className="work-form">
        <p className={`work-state ${task.state === 'ACCEPTED' ? 'paid' : 'busy'}`}>
          {verifying && (
            <>
              <LoaderCircle size={15} className="spin" aria-hidden /> Waiting for the tests to finish
              {waitingFor ? `: ${waitingFor}.` : '.'}
            </>
          )}
          {task.state === 'ACCEPTED' && 'It works. Paying you now.'}
          {task.state === 'REJECTED' && `Rejected: ${lastVerdict?.reason ?? 'the acceptance check failed.'}`}
        </p>
        {lastError && verifying && <p className="work-hint">Last check could not reach GitHub ({lastError}); it will retry.</p>}
        {(verifying || task.state === 'ACCEPTED') && (
          <button
            type="button"
            className="btn btn-glass btn-wide"
            disabled={busy !== null}
            onClick={() => void run('check', () => post(`/api/work/${task.id}/check`))}
          >
            <Roll><RefreshCw size={15} className={busy === 'check' ? 'spin' : undefined} /> {busy === 'check' ? 'Checking...' : 'Check again'}</Roll>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="work-panel">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={task.state}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        >
          {body}
        </motion.div>
      </AnimatePresence>
      {error && <p className="form-error form-feedback">{error}</p>}
    </div>
  )
}
