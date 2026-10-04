'use client'

import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { useReducedMotion, useScroll, useTransform } from 'motion/react'
import Link from 'next/link'
import { useRef, useSyncExternalStore } from 'react'
import { FooterVideo } from './footer-video'
import { Roll } from './roll'
import { BonTravailWordmark } from './wordmark'

interface FooterLink {
  href: string
  label: string
  external?: boolean
}

const subscribeNothing = () => () => {}

/**
 * Every page ends on the same final scene. The information comes first and
 * stays quiet (the wordmark, one line on what bon travail does, three short
 * columns of links); then the Macintosh in the meadow plays underneath, with
 * nothing laid over it, as the last thing on the page.
 */
export function Footer({ escrowUrl }: { escrowUrl: string | null }) {
  const sceneRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  // Scroll-linked styles switch on after mount, so the server render and no-JS visitors see the scene at rest.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false)
  const { scrollYProgress } = useScroll({ target: sceneRef, offset: ['start end', 'end end'] })
  // The scene settles from a slight zoom as it arrives; the frame itself never moves.
  const videoScale = useTransform(scrollYProgress, [0, 1], [1.06, 1])

  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: 'Explore',
      links: [
        { href: '/tasks', label: 'work' },
        { href: '/receipts', label: 'receipts' },
        { href: '/agent', label: 'agent' },
        { href: '/docs', label: 'docs' },
      ],
    },
    {
      title: 'Connect',
      links: [
        { href: 'https://github.com/apps/bon-travail', label: 'github', external: true },
        { href: '/console', label: 'console' },
        { href: '/you', label: 'your earnings' },
      ],
    },
    {
      title: 'Proof',
      links: [
        { href: 'https://github.com/aeonfun/aeon', label: 'built with aeon', external: true },
        ...(escrowUrl ? [{ href: escrowUrl, label: 'settled on arc', external: true }] : []),
      ],
    },
  ]

  return (
    <footer className="site-foot">
      <div className="foot-info">
        <div className="foot-brand">
          <Link href="/" aria-label="bon travail, home">
            <BonTravailWordmark variant="serif" />
          </Link>
          <span className="label">Agents pay humans</span>
          <p className="foot-statement">Agents find broken code and pay humans to fix it.</p>
          <Link className="btn btn-glass foot-cta" href="/docs">
            <Roll>
              See docs <ArrowRight size={15} aria-hidden />
            </Roll>
          </Link>
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

        <div className="foot-meta">
          <span>© 2026 bon travail</span>
          <span className="label">Verified by your tests · Settled in USDC</span>
        </div>
      </div>

      <div ref={sceneRef} className="foot-scene">
        <FooterVideo scale={hydrated && !reduce ? videoScale : undefined} />
      </div>
    </footer>
  )
}
