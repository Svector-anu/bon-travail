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
 * One small pill at the top centre: the wordmark and a menu button. The menu
 * opens as a second bar beneath it. The engineers' door stays visible on its
 * own, since contributors need no account and only the engineer signs in.
 */
export function Header({ owner }: { owner: boolean }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const dockRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)

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
        <div className="nav-pill">
          <Link href="/" className="brand" onClick={close}>
            <BonTravailWordmark />
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
        <nav id="site-menu" className="nav-menu" aria-label="Primary" inert={!open}>
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
