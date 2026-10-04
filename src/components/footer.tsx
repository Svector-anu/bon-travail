'use client'

import { ArrowUpRight } from 'lucide-react'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import Link from 'next/link'
import { useRef, useSyncExternalStore } from 'react'
import { BonTravailWordmark } from './wordmark'

interface FooterLink {
  href: string
  label: string
  external?: boolean
}

const subscribeNothing = () => () => {}

/**
 * Every page ends the same way: one closing line over the monolith at sunset,
 * then a small, ordinary footer with the places worth going next. The scene
 * has a rounded top so its edge shows at the bottom of the screen before you
 * reach it, a hint that the page goes on.
 */
export function Footer({ escrowUrl }: { escrowUrl: string | null }) {
  const sceneRef = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  // Parallax switches on after mount, so the server render and no-JS visitors get the still scene.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false)
  const { scrollYProgress } = useScroll({ target: sceneRef, offset: ['start end', 'end end'] })
  const imageY = useTransform(scrollYProgress, [0, 1], ['-10%', '0%'])

  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: 'For humans',
      links: [
        { href: '/tasks', label: 'Paid work' },
        { href: '/you', label: 'Your earnings' },
        { href: '/receipts', label: 'Receipts' },
      ],
    },
    {
      title: 'For teams',
      links: [
        { href: '/console', label: 'Console' },
        { href: '/agent', label: 'Aeon, the agent' },
        { href: 'https://github.com/apps/bon-travail', label: 'GitHub App', external: true },
      ],
    },
    {
      title: 'More',
      links: [
        { href: '/docs', label: 'Docs' },
        ...(escrowUrl ? [{ href: escrowUrl, label: 'Escrow on Arc', external: true }] : []),
      ],
    },
  ]

  return (
    <footer className="site-foot">
      <section ref={sceneRef} className="foot-scene" aria-label="Closing">
        <motion.div className="foot-scene-media" style={hydrated && !reduce ? { y: imageY } : undefined} aria-hidden>
          <picture>
            <source media="(max-width: 720px)" srcSet="/scenes/footer-scene-sm.jpg" />
            <img src="/scenes/footer-scene.jpg" alt="" loading="lazy" decoding="async" />
          </picture>
        </motion.div>
        <p className="foot-statement">
          <span>machines find the work.</span> <span>humans finish it.</span>
        </p>
      </section>

      <div className="foot-panel">
        <div className="foot-brand">
          <Link href="/" aria-label="bon travail, home">
            <BonTravailWordmark />
          </Link>
          <p>Work, verified. Agents find what's broken, and humans get paid to fix it.</p>
        </div>

        <nav className="foot-columns" aria-label="Footer">
          {columns.map((column) => (
            <div key={column.title}>
              <span className="label">{column.title}</span>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a href={link.href} target="_blank" rel="noreferrer">
                        {link.label} <ArrowUpRight size={12} aria-hidden />
                      </a>
                    ) : (
                      <Link href={link.href}>{link.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="foot-legal">
          <span>© 2026 bon travail</span>
          <span className="foot-flow" aria-label="Agents, then humans, then proof">
            agents <span aria-hidden>→</span> humans <span aria-hidden>→</span> proof
          </span>
        </div>
      </div>
    </footer>
  )
}
