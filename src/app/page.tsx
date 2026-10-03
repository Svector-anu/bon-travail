import { ArrowRight, CircleDollarSign, GitPullRequest, Play, Timer } from 'lucide-react'
import Link from 'next/link'
import { shortAddress } from '@/domain/address'
import { AutoRefresh } from '@/components/auto-refresh'
import { Ago, Countdown } from '@/components/clock'
import { HeroVideo } from '@/components/hero-video'
import { Reveal } from '@/components/reveal'
import { homeSnapshot, recentReceipts } from '@/server/queries'

export const dynamic = 'force-dynamic'

const LOOP = [
  ['Observe', 'Our agent, Aeon, watches the automated tests of the repository you connect. One failed run is noise; the same test failing again is worth a look.'],
  ['Investigate', 'Aeon reruns the failing test itself, finds the exact commit that broke it, and writes up what went wrong in plain words.'],
  ['Decide', 'You read the evidence and choose: keep it in the team, or externalize it with a reward, a deadline and the people allowed to take it.'],
  ['Fix', 'An approved contributor opens a pull request against the scoped work. They cannot touch the workflow or the acceptance test.'],
  ['Verify', 'Your project\'s own tests decide, not a person and not the agent. Once you merge the fix, the same test that was failing has to pass.'],
  ['Settle', 'Green pays the contributor from escrow on Arc. A missed deadline refunds you. Either way a receipt is sealed, and Aeon keeps watching for the failure to come back.'],
] as const

const ROLES = [
  ['Machines', 'Find, reproduce, prepare, check', 'Aeon watches, reproduces and explains failures; your test suite checks the fix. Neither can approve work or pay anyone.'],
  ['People', 'Do the work', 'An engineer you approved fixes what still benefits from a person, inside the scope you set.'],
  ['Your team', 'Owns every decision', 'Architecture, secrets, severity, scope, who can claim, the reward and the release stay with you.'],
] as const

export default async function HomePage() {
  const [home, receipts] = await Promise.all([homeSnapshot(), recentReceipts(4)])
  const current = home.live.find((t) => t.state === 'OPEN') ?? home.live[0] ?? null

  return (
    <Reveal>
      <AutoRefresh everyMs={8000} />

      <section className="bleed hero">
        <div className="hero-media" aria-hidden>
          <HeroVideo />
        </div>
        <div className="hero-copy">
          <span className="label">Agents pay humans</span>
          <h1>
            Your agents find
            <br />
            the work. People
            <br />
            fix it. Proof pays.
          </h1>
          <p>Our agent, Aeon, spots tests that keep failing and works out why. You decide who fixes it. When their fix passes your tests, they are paid in USDC automatically.</p>
          <div className="hero-ctas">
            <Link className="btn btn-primary" href={current ? `/task/${current.id}` : '/tasks'}>
              See open work <ArrowRight size={16} />
            </Link>
            <Link className="btn btn-glass" href="#how">
              <Play size={14} /> How it works
            </Link>
          </div>
        </div>
        <div className="hero-stats">
          <div>
            <strong className="tnum">{home.reposWatched}</strong>
            <span>Repos watched</span>
          </div>
          <div>
            <strong className="tnum">{home.paidCount}</strong>
            <span>Fixes paid</span>
          </div>
          <div>
            <strong className="tnum">{home.refundedCount}</strong>
            <span>Refunded</span>
          </div>
        </div>
      </section>

      <div className="home-grid">
        <section className="panel current-task">
          <div className="panel-title">
            <span className="label">Open work</span>
            {current && <span className="label">{current.displayId}</span>}
          </div>
          {current?.ci ? (
            <>
              <h2>{current.title}</h2>
              <p>{current.ci.acceptance}</p>
              <div className="facts">
                <div className="fact">
                  <span className="well"><CircleDollarSign size={20} /></span>
                  <div>
                    <span>Reward</span>
                    <strong>{current.reward} USDC</strong>
                  </div>
                </div>
                <div className="fact">
                  <span className="well"><Timer size={20} /></span>
                  <div>
                    <span>Time left</span>
                    <strong className="tnum">
                      <Countdown to={current.deadlineAt} done="closing" />
                    </strong>
                  </div>
                </div>
                <div className="fact">
                  <span className="well"><GitPullRequest size={20} /></span>
                  <div>
                    <span>Open to</span>
                    <strong>{current.ci.contributors.map((c) => `@${c}`).join(', ')}</strong>
                  </div>
                </div>
              </div>
              <Link className="btn btn-primary" href={`/task/${current.id}`}>
                {current.state === 'OPEN' ? 'View the work package' : 'Follow its progress'} <ArrowRight size={16} />
              </Link>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 14 }}>
              No open work right now. Engineers externalize work from their console when a finding is worth handing out.
            </p>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">
            <span className="label">Recent receipts</span>
            <Link className="text-link" href="/receipts">
              All <ArrowRight size={13} />
            </Link>
          </div>
          {receipts.length === 0 && <p className="muted">The first payout or refund lands here.</p>}
          {receipts.map((r) => {
            const paid = r.outcome === 'PAID'
            const who = r.workerHandle ? `@${r.workerHandle}` : r.worker ? shortAddress(r.worker) : null
            return (
              <Link key={r.taskId} href={`/receipt/${r.taskId}`} className="receipt-mini">
                <strong>
                  <span className={`status ${paid ? 'paid' : 'refund'}`}>{paid ? 'Paid' : 'Refunded'}</span>
                  {r.displayId}
                </strong>
                <small>
                  {paid && who ? `to ${who} · ` : 'back to treasury · '}
                  <Ago ts={r.settledAt} />
                  {r.simulated ? ' · simulated' : ''}
                </small>
                <span className="amount tnum">{r.reward} USDC</span>
              </Link>
            )
          })}
        </section>
      </div>

      <section className="roles" aria-label="Who does what">
        {ROLES.map(([who, what, copy]) => (
          <div key={who}>
            <span className="label">{who}</span>
            <strong>{what}</strong>
            <p>{copy}</p>
          </div>
        ))}
      </section>

      <section className="how" id="how">
        <div>
          <span className="label">How it works</span>
          <h2>Machines prepare and verify. People do the work. The chain settles.</h2>
        </div>
        <ol>
          {LOOP.map(([title, copy], i) => (
            <li key={title}>
              <span>0{i + 1}</span>
              <div>
                <strong>{title}</strong>
                <p>{copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </Reveal>
  )
}
