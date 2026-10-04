'use client'

import { LayoutPanelTop, LogIn } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Roll } from './roll'
import { BonTravailWordmark } from './wordmark'

const NAV = [
  { href: '/tasks', label: 'Work', match: ['/tasks', '/task/'] },
  { href: '/receipts', label: 'Receipts', match: ['/receipts', '/receipt/'] },
  { href: '/agent', label: 'Agent', match: ['/agent'] },
  { href: '/docs', label: 'Docs', match: ['/docs'] },
]

/**
 * One small dark pill at the top centre: the serif wordmark and a menu button. The menu
 * drips out of it: a drop swells under the pill, falls, and spreads into the
 * bar of links (an SVG goo filter merges the shapes; the text sits above it,
 * unfiltered). The engineers' door stays visible on its
 * own, since contributors need no account and only the engineer signs in.
 */
export function Header({ owner }: { owner: boolean }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const dockRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const close = () => setOpen(false)

  // The liquid shapes are drawn behind the real pill and menu, so they track their measured size.
  useEffect(() => {
    const dock = dockRef.current
    const pill = pillRef.current
    const menu = menuRef.current
    if (!dock || !pill || !menu) return
    const measure = () => {
      dock.style.setProperty('--pill-w', `${pill.offsetWidth}px`)
      dock.style.setProperty('--pill-h', `${pill.offsetHeight}px`)
      dock.style.setProperty('--menu-w', `${menu.offsetWidth}px`)
      dock.style.setProperty('--menu-h', `${menu.offsetHeight}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(pill)
    observer.observe(menu)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    const onPointer = (event: PointerEvent) => {
      if (!dockRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <header className="topbar">
      <div ref={dockRef} className="nav-dock" data-open={open || undefined}>
        <svg className="nav-goo-defs" aria-hidden focusable="false">
          <filter id="nav-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </svg>
        <div className="nav-goo" aria-hidden>
          <span className="goo-pill" />
          <span className="goo-drop" />
          <span className="goo-bar" />
        </div>
        <div ref={pillRef} className="nav-pill">
          <Link href="/" className="brand" onClick={close}>
            <BonTravailWordmark variant="serif" />
          </Link>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden />
            <span aria-hidden />
          </button>
        </div>
        <nav ref={menuRef} id="site-menu" className="nav-menu" aria-label="Primary" inert={!open}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              aria-current={item.match.some((m) => pathname.startsWith(m)) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <Link href="/console" className="pill-btn nav-cta" aria-current={pathname.startsWith('/console') ? 'page' : undefined}>
        <Roll>
          {owner ? <LayoutPanelTop size={15} aria-hidden /> : <LogIn size={15} aria-hidden />}
          {owner ? 'console' : 'engineers'}
        </Roll>
      </Link>
    </header>
  )
}
