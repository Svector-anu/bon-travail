'use client'

import { ArrowRight } from 'lucide-react'
import { useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { LoopScene } from './loop-scene'
import { Roll } from './roll'

const STEPS = [
  { label: 'aeon finds', copy: 'Aeon watches your CI. One red run is noise. The same one twice is work.' },
  { label: 'you decide', copy: 'You set the scope, the reward and who may claim it. Aeon suggests, never approves.' },
  { label: 'people fix', copy: 'Someone you trust opens a pull request inside that scope. Your tests stay off limits.' },
  { label: 'tests verify', copy: 'Your own tests decide. Not a person, not the agent.' },
  { label: 'proof pays', copy: 'USDC leaves escrow for the wallet you approved. The receipt keeps every step.' },
] as const

const LAST = STEPS.length - 1

/** Scroll progress through the pinned section → which form the cloud holds; it rests on each step before moving on. */
function morphAt(progress: number): number {
  const x = Math.min(Math.max(progress * STEPS.length - 0.5, 0), LAST)
  const base = Math.floor(x)
  const f = x - base
  const eased = f < 0.25 ? 0 : f > 0.75 ? 1 : (f - 0.25) / 0.5
  return Math.min(base + eased * eased * (3 - 2 * eased), LAST)
}

/**
 * The one explanation on the home page: the section pins, and scrolling walks
 * the loop. A point cloud changes form at each step (a loose cloud with one
 * failing knot, the evidence as a sphere, a branch merging back, a board of
 * checks, a ring), the step row grows the current step, and one line says
 * what happens. Without WebGL the steps and words still work on their own.
 */
export function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<LoopScene | null>(null)
  const targetRef = useRef(0)
  const [active, setActive] = useState(0)
  const [webgl, setWebgl] = useState(true)
  const reduce = useReducedMotion() ?? false
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] })

  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    const morph = morphAt(progress)
    targetRef.current = morph
    sceneRef.current?.setTarget(morph)
    setActive(Math.round(morph))
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const section = sectionRef.current
    if (!canvas || !section) return
    let scene: LoopScene | null = null
    let cancelled = false
    const visibility = new IntersectionObserver(([entry]) => scene?.setActive(Boolean(entry?.isIntersecting)))
    import('./loop-scene')
      .then(({ createLoopScene }) => {
        if (cancelled) return
        scene = createLoopScene(canvas, { reduceMotion: reduce })
        sceneRef.current = scene
        scene.setTarget(targetRef.current)
        visibility.observe(section)
      })
      .catch(() => {
        // No WebGL (old GPU, blocked context): the steps and words carry the section alone.
        if (!cancelled) setWebgl(false)
      })
    return () => {
      cancelled = true
      visibility.disconnect()
      scene?.dispose()
      sceneRef.current = null
    }
  }, [reduce])

  const goTo = (step: number) => {
    const section = sectionRef.current
    if (!section) return
    const top = section.getBoundingClientRect().top + window.scrollY
    const travel = section.offsetHeight - window.innerHeight
    window.scrollTo({ top: top + ((step + 0.5) / STEPS.length) * travel, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <section ref={sectionRef} className="loop" id="how" aria-labelledby="loop-title" style={{ '--loop-steps': STEPS.length } as React.CSSProperties}>
      <div className="loop-pin">
        <header className="loop-head">
          <span className="label">How it works</span>
          <h2 id="loop-title">Here, a failing test stops nagging and starts paying.</h2>
        </header>

        <div className="loop-stage" aria-hidden>
          {webgl && <canvas ref={canvasRef} className="loop-canvas" />}
        </div>

        <ol className="loop-steps">
          {STEPS.map((step, i) => (
            <li key={step.label}>
              <button type="button" aria-current={i === active ? 'step' : undefined} onClick={() => goTo(i)}>
                {step.label}
              </button>
            </li>
          ))}
        </ol>
        <p key={active} className="loop-caption" aria-live="polite">
          {STEPS[active]!.copy}
        </p>
        <Link className="btn btn-glass loop-more" href="/docs">
          <Roll>
            The details live in the docs <ArrowRight size={15} />
          </Roll>
        </Link>
      </div>
    </section>
  )
}
