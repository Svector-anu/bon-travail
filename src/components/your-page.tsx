'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { WorkerSummary } from '@/server/queries'
import { Ago, Countdown } from './clock'
import { useIdentity } from './identity'
import { Roll } from './roll'

const POLL_MS = 5000

export function YourPage() {
  const identity = useIdentity()
  const [summary, setSummary] = useState<WorkerSummary | null>(null)
  const address = identity.address

  useEffect(() => {
    if (!address) return
    const controller = new AbortController()
    const load = () =>
      fetch(`/api/workers/${address}`, { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<WorkerSummary>) : null))
        .then((data) => setSummary(data))
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) setSummary(null)
        })
    void load()
    const id = setInterval(load, POLL_MS)
    return () => {
      controller.abort()
      clearInterval(id)
    }
  }, [address])

  const data = address && summary?.address.toLowerCase() === address.toLowerCase() ? summary : null

  if (!address) {
    return (
      <div className="empty">
        <p style={{ marginBottom: 18 }}>
          {identity.mode === 'privy'
            ? 'Sign in with email, Google or X. A wallet is created for you and your earnings show up here.'
            : 'Connect a wallet, or claim a task with a payout address, and your earnings show up here.'}
        </p>
        <button type="button" className="btn btn-primary" onClick={identity.signIn} disabled={!identity.ready}>
          <Roll>{identity.mode === 'privy' ? 'Sign in' : 'Connect wallet'}</Roll>
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="stats-line">
        <div>
          <strong className="tnum">{data?.earned ?? '--'}</strong>
          <span>USDC earned</span>
        </div>
        <div>
          <strong className="tnum">{data && data.paidCount > 0 ? data.paidCount : '--'}</strong>
          <span>Tasks paid</span>
        </div>
        <div>
          <strong className="tnum">{data && data.answered > 0 ? `${data.answered - data.rejected}/${data.answered}` : '--'}</strong>
          <span>Answers matched</span>
        </div>
      </div>

      {data?.activeClaim && (
        <Link className="task-row featured" href={`/task/${data.activeClaim.taskId}/submit`} style={{ marginBottom: 12 }}>
          <span className="status busy">Claimed</span>
          <span className="id">{data.activeClaim.displayId}</span>
          <h3>Finish your answer</h3>
          <p className="desc">
            Lock ends in <Countdown to={data.activeClaim.expiresAt} done="now" />
          </p>
          <span className="go" aria-hidden>
            <ArrowRight size={16} />
          </span>
        </Link>
      )}

      <section className="panel">
        <div className="panel-title">
          <span className="label">History</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>{address}</span>
        </div>
        {!data || data.history.length === 0 ? (
          <p className="muted">No answers yet.</p>
        ) : (
          data.history.map((h) => (
            <Link key={`${h.taskId}-${h.at}`} href={`/receipt/${h.taskId}`} className="receipt-mini">
              <strong>
                <span className={`status ${h.outcome === 'PASS' ? 'paid' : 'refund'}`}>
                  {h.outcome === 'PASS' ? 'Matched' : h.outcome === 'FAIL' ? 'No match' : 'Lapsed'}
                </span>
                {h.displayId}
              </strong>
              <small>
                <Ago ts={h.at} />
              </small>
              <span className="amount">
                <ArrowRight size={14} />
              </span>
            </Link>
          ))
        )}
      </section>
    </>
  )
}
