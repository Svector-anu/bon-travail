'use client'

import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import Link from 'next/link'
import { useRef, useSyncExternalStore } from 'react'

const LINKS = [
  { href: '/tasks', label: 'work' },
  { href: '/receipts', label: 'receipts' },
  { href: '/agent', label: 'agent' },
  { href: '/docs', label: 'docs' },
  { href: 'https://github.com/apps/bon-travail', label: 'github', external: true },
] as const

const subscribeNothing = () => () => {}

/** The resting scene: what the server renders, what no-JS and reduced-motion visitors see. */
const STILL = { opacity: 1, y: 0, scale: 1 }

/**
 * The last scene of every page: the monolith at sunset, with the product's
 * one-line promise set over the sky. As it scrolls into view the landscape
 * settles a few percent and the words arrive after it; metadata comes last.
 * The image carries no text, so everything stays crisp, selectable and clickable.
 */
export function Footer() {
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  // Scroll motion switches on after mount: the server and the first render show the
  // resting scene, so nothing is ever stuck hidden. The footer starts below the fold,
  // so the switch is never visible.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false)
  const live = hydrated && !reduce
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] })
  const imageY = useTransform(scrollYProgress, [0, 1], ['-7%', '0%'])
  const imageScale = useTransform(scrollYProgress, [0, 1], [1.06, 1])
  const copyOpacity = useTransform(scrollYProgress, [0.35, 0.75], [0, 1])
  const copyY = useTransform(scrollYProgress, [0.35, 0.8], [28, 0])
  const metaOpacity = useTransform(scrollYProgress, [0.7, 0.98], [0, 1])

  return (
    <footer ref={ref} className="scene-footer">
      <motion.div className="scene-media" style={live ? { y: imageY, scale: imageScale } : STILL} aria-hidden>
        <picture>
          <source media="(max-width: 720px)" srcSet="/scenes/footer-scene-sm.jpg" />
          <img src="/scenes/footer-scene.jpg" alt="" loading="lazy" decoding="async" />
        </picture>
      </motion.div>
      <div className="scene-shade" aria-hidden />

      <motion.div className="scene-copy" style={live ? { opacity: copyOpacity, y: copyY } : STILL}>
        <Link href="/" className="scene-brand">
          <img src="/mascots/seedling.png" alt="" />
          bon travail
        </Link>
        <p className="scene-statement">
          <span>machines find the work.</span> <span>humans finish it.</span>
        </p>
        <nav className="scene-links" aria-label="Footer">
          {LINKS.map((link) =>
            'external' in link ? (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ),
          )}
        </nav>
        <p className="scene-flow" aria-label="Agents, then humans, then proof">
          agents <span aria-hidden>→</span> humans <span aria-hidden>→</span> proof
        </p>
      </motion.div>

      <motion.div className="scene-meta" style={live ? { opacity: metaOpacity } : { opacity: 1 }}>
        <span>built with aeon</span>
        <span>settled on arc</span>
        <span>work, verified.</span>
        <span className="scene-copyright">© 2026 bon travail</span>
      </motion.div>
    </footer>
  )
}
