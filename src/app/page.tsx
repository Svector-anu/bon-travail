import { ArrowRight, Play } from 'lucide-react'
import Link from 'next/link'
import { HeroVideo } from '@/components/hero-video'
import { HowItWorks } from '@/components/how-it-works'
import { Reveal } from '@/components/reveal'
import { Roll } from '@/components/roll'
import { openWork } from '@/server/queries'

export const dynamic = 'force-dynamic'

/** Three parts and no more: the promise, how the loop works, and the footer. Everything else lives in /docs. */
export default async function HomePage() {
  const current = await openWork()

  return (
    <Reveal>
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
              <Roll>See open work <ArrowRight size={16} /></Roll>
            </Link>
            <Link className="btn btn-glass" href="#how">
              <Roll><Play size={14} /> How it works</Roll>
            </Link>
          </div>
        </div>
      </section>

      <HowItWorks />
    </Reveal>
  )
}
