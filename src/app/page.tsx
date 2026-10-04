import { ArrowRight, Play } from 'lucide-react'
import Link from 'next/link'
import { HeroVideo } from '@/components/hero-video'
import { HowItWorks } from '@/components/how-it-works'
import { Roll } from '@/components/roll'
import { openWork } from '@/server/queries'

export const dynamic = 'force-dynamic'

const HEADLINE = ['Your agents find', 'the work. People', 'fix it. Proof pays.']

/** Each word with its place in the whole headline, so the entrance can stagger across lines. */
const HEADLINE_LINES = HEADLINE.map((line, row) => {
  const before = HEADLINE.slice(0, row).reduce((sum, l) => sum + l.split(' ').length, 0)
  return line.split(' ').map((word, i) => ({ word, order: before + i }))
})

/** The headline arrives a word at a time, rising out of a blur, while the scene lifts from the dark. CSS only, so it plays before hydration. */
function Headline() {
  return (
    <h1 className="hero-title">
      {HEADLINE_LINES.map((words, row) => (
        <span key={row} className="hero-line">
          {words.map(({ word, order }) => (
            <span key={order}>
              <span className="hero-word" style={{ '--i': order } as React.CSSProperties}>
                {word}
              </span>{' '}
            </span>
          ))}
        </span>
      ))}
    </h1>
  )
}

/** Three parts and no more: the promise, how the loop works, and the footer. Everything else lives in /docs. */
export default async function HomePage() {
  const current = await openWork()

  return (
    <>
      <section className="bleed hero">
        <div className="hero-media" aria-hidden>
          <HeroVideo />
        </div>
        <div className="hero-copy">
          <span className="label">Agents pay humans</span>
          <Headline />
          <p>Aeon notices the test that keeps failing and works out why. You choose who fixes it. When your tests pass, they are paid. No invoices, no chasing.</p>
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
    </>
  )
}
