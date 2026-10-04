'use client'

import { ArrowRight } from 'lucide-react'
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { LoopScene } from './loop-scene'

const STEPS = [
  {
    label: 'noticed',
    copy: 'The bug your team keeps ignoring finally gets noticed, along with exactly where it broke.',
  },
  {
    label: 'fixed',
    copy: 'A human you trust fixes it, so your team can stay on the work that matters.',
  },
  {
    label: 'paid',
    copy: 'When the fix works, they get paid on the spot, and you both keep a receipt.',
  },
] as const

const LAST = STEPS.length - 1

const subscribeNothing = () => () => {}

/** The paper starts as a smaller screen in the dark and widens to fill the view, like a cinema screen opening. */
const screenAt = (open: number) => {
  const closed = 1 - open
  return `inset(${(7 * closed).toFixed(2)}vh ${(18 * closed).toFixed(2)}vw 0 ${(18 * closed).toFixed(2)}vw round ${(32 + 16 * closed).toFixed(1)}px)`
}

/** Scroll progress through the pinned section → which form the cloud holds; it rests on each step before moving on. */
function morphAt(progress: number): number {
  const x = Math.min(Math.max(progress * STEPS.length - 0.5, 0), LAST)
  const base = Math.floor(x)
  const f = x - base
  const eased = f < 0.25 ? 0 : f > 0.75 ? 1 : (f - 0.25) / 0.5
  return Math.min(base + eased * eased * (3 - 2 * eased), LAST)
}

/**
 * The middle of the home page: what changes for a team once agents can pay
 * humans. The section pins and scrolling moves through three moments, each
 * with its own form in the point cloud (a failure noticed, a branch merged
 * back, a ring for the payment). Without WebGL the words carry it alone.
 */
export function WhatChanges() {
  const sectionRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<LoopScene | null>(null)
  const targetRef = useRef(0)
  const [active, setActive] = useState(0)
  const [webgl, setWebgl] = useState(true)
  const reduce = useReducedMotion() ?? false
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] })
  // How far the screen has opened: closed as it enters from below, fully open when it reaches the top.
  const { scrollYProgress: entering } = useScroll({ target: sectionRef, offset: ['start end', 'start start'] })
  const clipPath = useTransform(entering, screenAt)
  const contentScale = useTransform(entering, [0, 1], [0.9, 1])
  // Scroll-linked styles switch on after mount, so the server render and no-JS visitors see the open screen.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false)
  const cinematic = hydrated && !reduce

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
    <motion.section
      ref={sectionRef}
      className="loop"
      id="how"
      aria-labelledby="loop-title"
      style={{ '--loop-steps': STEPS.length, ...(cinematic ? { clipPath } : {}) } as React.CSSProperties}
    >
      <motion.div className="loop-pin" style={cinematic ? { scale: contentScale } : undefined}>
        <header className="loop-head">
          <span className="label">Agents pay humans</span>
          <h2 id="loop-title">What changes when your agents can pay humans</h2>
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
        <Link className="loop-more" href="/docs">
          See docs <ArrowRight size={14} aria-hidden />
        </Link>
      </motion.div>
    </motion.section>
  )
}
