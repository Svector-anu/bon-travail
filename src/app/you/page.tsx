import { ArrowRight, ArrowUpRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Ago } from '@/components/clock'
import { Reveal } from '@/components/reveal'
import { Roll } from '@/components/roll'
import { TASK_STATUS } from '@/lib/format'
import { contributorLedger } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your earnings' }

/** A contributor needs no account: their GitHub login (or payout wallet) is the key to their record. */
export default async function YouPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const who = ((await searchParams).who ?? '').slice(0, 64)
  const ledger = who ? await contributorLedger(who) : null

  return (
    <Reveal>
      <div className="page-head">
        <div>
          <span className="label">Humans</span>
          <h1>your earnings.</h1>
          <p>Look yourself up by GitHub name or wallet. No sign-up needed.</p>
        </div>
      </div>

      <form className="lookup" action="/you" method="get">
        <label className="sr-only" htmlFor="who">
          GitHub login or payout wallet
        </label>
        <input id="who" name="who" className="input mono" placeholder="@your-login or 0x…" defaultValue={who} autoComplete="off" spellCheck={false} />
        <button type="submit" className="btn btn-primary">
          <Roll>
            Look up <ArrowRight size={15} />
          </Roll>
        </button>
      </form>

      {who && !ledger && <p className="form-error">That is not a GitHub login or a wallet address.</p>}

      {ledger && (
        <section className="ledger-view">
          <div className="ledger-totals">
            <div>
              <strong className="tnum">{ledger.earned}</strong>
              <span>USDC earned</span>
            </div>
            <div>
              <strong className="tnum">{ledger.paidCount}</strong>
              <span>{ledger.paidCount === 1 ? 'fix paid' : 'fixes paid'}</span>
            </div>
            <div>
              <strong className="tnum">{ledger.entries.length}</strong>
              <span>{ledger.entries.length === 1 ? 'job taken' : 'jobs taken'}</span>
            </div>
          </div>
          {ledger.entries.length === 0 ? (
            <div className="empty">
              Nothing on record for {ledger.kind === 'login' ? `@${ledger.query}` : ledger.query} yet. Work saved for you shows up on{' '}
              <Link href="/tasks">the work page</Link>.
            </div>
          ) : (
            <ul className="ledger-rows">
              {ledger.entries.map((e) => {
                const status = e.outcome === 'PAID' ? TASK_STATUS.PAID : TASK_STATUS[e.state as keyof typeof TASK_STATUS]
                return (
                  <li key={e.taskId}>
                    <span className={`status ${status.tone}`}>{status.label}</span>
                    <Link href={e.outcome === 'PAID' || e.state === 'REFUNDED' ? `/receipt/${e.taskId}` : `/task/${e.taskId}`}>
                      <strong>{e.displayId}</strong> {e.title}
                    </Link>
                    <span className="tnum">{e.reward} USDC</span>
                    <small>
                      claimed <Ago ts={e.claimedAt} />
                      {e.payoutTxUrl && (
                        <>
                          {' · '}
                          <a href={e.payoutTxUrl} target="_blank" rel="noreferrer">
                            payout <ArrowUpRight size={12} />
                          </a>
                        </>
                      )}
                      {e.simulated && ' · simulated'}
                    </small>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </Reveal>
  )
}
