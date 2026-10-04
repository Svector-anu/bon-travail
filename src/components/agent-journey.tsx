'use client'

import { CircleDollarSign, Eye, Hand, RefreshCw, Search, ShieldCheck, UserCheck, type LucideIcon } from 'lucide-react'
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

export interface JourneyStop {
  key: string
  count: number
  title: string
  copy: string
}

const ICONS: Record<string, LucideIcon> = {
  observing: Eye,
  investigating: Search,
  awaiting: UserCheck,
  humans: Hand,
  verifying: ShieldCheck,
  paid: CircleDollarSign,
  watching: RefreshCw,
}

const TILT = [-8, 7, -5, 9, -7, 6, -9]

/**
 * Aeon's loop as one line down the page. The line fills as you scroll, like
 * syrup running down, and each stop lights up when the fill reaches it. Every
 * stop carries the live count of work standing there right now.
 */
export function AgentJourney({ stops }: { stops: JourneyStop[] }) {
  const ref = useRef<HTMLOListElement>(null)
  const reduce = useReducedMotion()
  // The head of the fill sits on a reading line just below the middle of the screen.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 58%', 'end 58%'] })
  // A light spring gives the fill weight, so it runs on a moment after the scroll stops.
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.5 })
  const [reached, setReached] = useState(reduce ? stops.length : 0)
  // Where each tile sits along the line, as a fraction of its length.
  const marks = useRef<number[]>([])

  useEffect(() => {
    const list = ref.current
    if (!list) return
    const measure = () => {
      const total = list.offsetHeight || 1
      marks.current = [...list.querySelectorAll<HTMLElement>('.journey-tile')].map((tile) => {
        const stop = tile.parentElement as HTMLElement
        return (stop.offsetTop + tile.offsetTop + tile.offsetHeight / 2) / total
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  useMotionValueEvent(fill, 'change', (value) => {
    const next = marks.current.filter((mark) => value >= mark).length
    setReached((current) => (current === next ? current : next))
  })

  const lit = (i: number) => reduce || i < reached

  return (
    <ol ref={ref} className="journey">
      <span className="journey-track" aria-hidden />
      <motion.span className="journey-fill" aria-hidden style={{ scaleY: reduce ? 1 : fill }} />
      {stops.map((stop, i) => {
        const Icon = ICONS[stop.key] ?? Eye
        return (
          <li key={stop.key} className={`journey-stop${i % 2 ? ' right' : ''}${lit(i) ? ' lit' : ''}`}>
            <div className="journey-text">
              <span className="journey-count">
                <span className="tnum">{stop.count}</span> now
              </span>
              <h3>{stop.title}</h3>
              <p>{stop.copy}</p>
            </div>
            <span className="journey-tile" style={{ rotate: `${TILT[i % TILT.length]}deg` }} aria-hidden>
              <Icon size={30} strokeWidth={1.5} />
            </span>
          </li>
        )
      })}
    </ol>
  )
}
