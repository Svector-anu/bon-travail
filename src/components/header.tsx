'use client'

import { LayoutPanelTop, LogIn } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Roll } from './roll'

const NAV = [
  { href: '/tasks', label: 'Work', match: ['/tasks', '/task/'] },
  { href: '/receipts', label: 'Receipts', match: ['/receipts', '/receipt/'] },
  { href: '/agent', label: 'Agent', match: ['/agent'] },
]

/** Contributors need no account: GitHub proves who opened the PR. Only the engineer signs in. */
export function Header({ owner }: { owner: boolean }) {
  const pathname = usePathname()
  const inConsole = pathname.startsWith('/console')

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <img src="/mascots/seedling.png" alt="" />
        <span>Bon Travail</span>
      </Link>

      <nav className="nav" aria-label="Primary">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.match.some((m) => pathname.startsWith(m)) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="top-actions">
        <Link href="/console" className="pill-btn" aria-current={inConsole ? 'page' : undefined}>
          <Roll>{owner ? <LayoutPanelTop size={15} aria-hidden /> : <LogIn size={15} aria-hidden />}
          {owner ? 'Console' : 'Engineers'}</Roll>
        </Link>
      </div>
    </header>
  )
}
