'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { CopyButton } from './copy-button'
import { useIdentity } from './identity'
import { identiconStyle } from './wallet'

const NAV = [
  { href: '/tasks', label: 'Tasks', match: ['/tasks', '/task/'] },
  { href: '/receipts', label: 'Receipts', match: ['/receipts', '/receipt/'] },
  { href: '/agent', label: 'Agent', match: ['/agent'] },
  { href: '/you', label: 'You', match: ['/you'] },
]

export function Header() {
  const pathname = usePathname()
  const identity = useIdentity()
  const [menuOpen, setMenuOpen] = useState(false)
  const signedIn = identity.signedIn && identity.address

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <img src="/mascots/seedling.png" alt="" />
        <span>Proofwork</span>
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
        {signedIn ? (
          <button type="button" className="pill-btn" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            <span className="identicon" style={identiconStyle(identity.address!)} aria-hidden />
            {identity.label}
          </button>
        ) : (
          <button type="button" className="pill-btn" disabled={!identity.ready} onClick={identity.signIn}>
            {identity.mode === 'privy' ? 'Sign in' : 'Connect'}
          </button>
        )}
        {menuOpen && signedIn && (
          <div className="menu">
            <p>
              {identity.embeddedWallet ? 'Your Proofwork wallet' : 'Payout wallet'}
              <span className="mono" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, color: 'var(--text)' }}>
                {identity.address}
                <CopyButton value={identity.address!} label="Copy address" />
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                identity.signOut()
                setMenuOpen(false)
              }}
            >
              {identity.mode === 'privy' ? 'Sign out' : 'Disconnect'}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
