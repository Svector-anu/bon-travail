'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { WorkerSummary } from '@/server/queries'
import { Countdown } from './clock'
import { connectInjected, disconnectWallet, hasInjectedWallet, useWallet } from './wallet'

const POLL_MS = 5000

/** Turnip "account" recipe, filled from the wallet's real attempts and payouts. */
export function YourPage() {
  const wallet = useWallet()
  const [summary, setSummary] = useState<WorkerSummary | null>(null)
  const address = wallet?.address ?? null

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

  return (
    <>
      <div className="balances">
        <div className="bal">
          <img src="/mascots/gift.png" alt="" />
          <div>
            <div className="stat-val tnum">{data?.earned ?? '--'}</div>
            <p>USDC earned</p>
          </div>
        </div>
        <div className="bal">
          <img src="/mascots/duck.png" alt="" />
          <div>
            <div className="stat-val tnum">{data && data.paidCount > 0 ? data.paidCount : '--'}</div>
            <p>Tasks paid</p>
          </div>
        </div>
      </div>

      <hr className="hairline" />

      <div className="balances">
        <div className="bal">
          <img src="/mascots/snail.png" alt="" />
          <div>
            <div className="stat-val tnum">{data && data.answered > 0 ? `${data.answered - data.rejected} / ${data.answered}` : '--'}</div>
            <p>Answers matched</p>
          </div>
        </div>
        <div className="bal">
          <img src="/mascots/seedling.png" alt="" />
          <div>
            <div className="stat-val tnum">
              {data?.activeClaim ? <Countdown to={data.activeClaim.expiresAt} done="--" /> : '--'}
            </div>
            <p>{data?.activeClaim ? `Lock on ${data.activeClaim.displayId}` : 'Active claim lock'}</p>
          </div>
        </div>
      </div>

      <div className="user-actions">
        <div className="user-actions-left">
          <Link className="btn ghost" href={data?.activeClaim ? `/task/${data.activeClaim.taskId}` : '/'}>
            {data?.activeClaim ? 'Finish task' : 'Find a task'}
          </Link>
          <Link className="btn ghost" href="/receipts">
            Receipts
          </Link>
        </div>
        {address ? (
          <button type="button" className="btn ghost" onClick={disconnectWallet}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="btn ghost" disabled={!hasInjectedWallet()} onClick={() => void connectInjected()}>
            Connect wallet
          </button>
        )}
      </div>

      {!address && (
        <p className="lede" style={{ marginTop: 28 }}>
          Connect a wallet, or claim any task with a payout address, and your earnings show up here.
        </p>
      )}
    </>
  )
}
