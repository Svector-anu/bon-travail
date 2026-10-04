'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { AttemptView, TaskView } from '@/domain/views'
import { saveClaim, useStoredClaim } from './claim-store'
import { useIdentity } from './identity'
import { Roll } from './roll'

const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase())

/** The single primary action on a task: claim, continue, or see the outcome. */
export function ClaimCta({ task, attempts }: { task: TaskView; attempts: AttemptView[] }) {
  const router = useRouter()
  const identity = useIdentity()
  const claim = useStoredClaim(task.id)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const holdsClaim = task.state === 'CLAIMED' && claim !== null && sameAddress(task.claimant, claim.wallet)
  const answered = identity.address ? attempts.some((a) => sameAddress(a.worker, identity.address)) : false
  const privy = identity.mode === 'privy'
  const payout = identity.address ?? (pasted.trim() || null)

  if (task.state === 'PAID' || task.state === 'REFUNDED' || task.state === 'EXPIRED') {
    return (
      <Link className="btn btn-primary btn-wide" href={`/receipt/${task.id}`}>
        <Roll>View receipt <ArrowRight size={16} /></Roll>
      </Link>
    )
  }
  if (holdsClaim || (claim && attempts.some((a) => a.claimId === claim.claimId))) {
    return (
      <Link className="btn btn-primary btn-wide" href={`/task/${task.id}/submit`}>
        <Roll>{holdsClaim ? 'Continue to your answer' : 'See your result'} <ArrowRight size={16} /></Roll>
      </Link>
    )
  }
  if (task.state !== 'OPEN') {
    return (
      <button type="button" className="btn btn-primary btn-wide" disabled>
        <Roll>{task.state === 'CLAIMED' ? 'Claimed by another worker' : 'Being verified'}</Roll>
      </button>
    )
  }
  if (answered) {
    return (
      <button type="button" className="btn btn-primary btn-wide" disabled>
        <Roll>You already answered this task</Roll>
      </button>
    )
  }

  async function onClaim(event: FormEvent) {
    event.preventDefault()
    if (privy && !identity.signedIn) return identity.signIn()
    if (!payout) return setError(privy ? 'Your wallet is still being created. Try again in a moment.' : 'Enter a payout address.')
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/${task.id}/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await identity.authHeaders()) },
        body: JSON.stringify({ wallet: payout }),
      })
      const data = (await res.json()) as { claimId?: string; claimToken?: string; claimExpiresAt?: number; message?: string }
      if (!res.ok || !data.claimId || !data.claimToken || !data.claimExpiresAt) throw new Error(data.message ?? 'Claim failed')
      if (!privy && !identity.address) identity.rememberPayoutAddress?.(payout)
      saveClaim(task.id, { claimId: data.claimId, claimToken: data.claimToken, wallet: payout, expiresAt: data.claimExpiresAt })
      router.push(`/task/${task.id}/submit`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Claim failed')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onClaim}>
      {!privy && !identity.address && (
        <div className="inline-field field">
          <label htmlFor="payout">Payout address</label>
          <input
            id="payout"
            className="input mono"
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy || (privy && identity.signedIn && !identity.address)}>
        <Roll>{busy ? 'Claiming...' : privy && !identity.signedIn ? 'Sign in to claim' : 'Claim this task'}
        {!busy && <ArrowRight size={16} />}</Roll>
      </button>
      {error && <p className="form-error form-feedback">{error}</p>}
      {identity.signedIn && payout && (
        <p className="muted claim-hint">
          You get a 10 minute lock. The reward goes to <span className="mono">{payout.slice(0, 6)}...{payout.slice(-4)}</span>.
        </p>
      )}
    </form>
  )
}
