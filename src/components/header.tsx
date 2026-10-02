'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'
import { THEME_KEY } from '@/lib/theme'
import { CopyButton } from './copy-button'
import { useIdentity } from './identity'
import { hasInjectedWallet, identiconStyle } from './wallet'

const themeListeners = new Set<() => void>()

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  try {
    window.localStorage.setItem(THEME_KEY, next)
  } catch {
    // Theme still applies for this page view; it just will not persist.
  }
  for (const l of themeListeners) l()
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener)
  return () => themeListeners.delete(listener)
}

const NAV = [
  { href: '/', label: 'Tasks' },
  { href: '/receipts', label: 'Receipts' },
  { href: '/agent', label: 'Agent' },
  { href: '/you', label: 'You' },
]

export function Header() {
  const pathname = usePathname()
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => 'light' as const)
  const identity = useIdentity()
  const [menuOpen, setMenuOpen] = useState(false)
  const canSignIn = identity.mode === 'privy' || hasInjectedWallet()

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/' || pathname.startsWith('/task')
    if (href === '/receipts') return pathname.startsWith('/receipt')
    return pathname.startsWith(href)
  }

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <img src="/mascots/seedling.png" alt="" />
        <span>Proofwork</span>
      </Link>

      <nav className="nav" aria-label="Primary">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="top-actions">
        <button
          type="button"
          className="icon-pill"
          onClick={toggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? <img src="/mascots/sun.png" alt="" /> : <MoonIcon />}
        </button>

        <div className="wallet-wrap">
          {identity.signedIn && identity.address ? (
            <button type="button" className="wallet-pill" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
              <span className="identicon" style={identiconStyle(identity.address)} aria-hidden />
              {identity.label}
            </button>
          ) : (
            <button
              type="button"
              className="wallet-pill connect"
              disabled={!identity.ready}
              onClick={canSignIn ? identity.signIn : () => setMenuOpen((v) => !v)}
            >
              {identity.mode === 'privy' ? 'Sign in' : 'Connect'}
            </button>
          )}
          {menuOpen && (
            <div className="dropdown">
              {identity.signedIn && identity.address ? (
                <>
                  <p className="dropdown-note">
                    {identity.embeddedWallet ? 'Your Proofwork wallet' : 'Payout wallet'}
                    <span className="mono" style={{ display: 'block', marginTop: 4, color: 'var(--text)' }}>
                      {identity.address}
                    </span>
                  </p>
                  <CopyButton value={identity.address} label="Copy address" />
                  <button
                    type="button"
                    onClick={() => {
                      identity.signOut()
                      setMenuOpen(false)
                    }}
                  >
                    {identity.mode === 'privy' ? 'Sign out' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <p className="dropdown-note">No browser wallet found. You can paste a payout address when you claim a task.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path
        fill="currentColor"
        d="M15.2 2.1a.8.8 0 0 1 .9 1.2A8.7 8.7 0 1 0 20.7 16a.8.8 0 0 1 1.3.8A10.3 10.3 0 1 1 14.4 2.2c.3 0 .6 0 .8-.1z"
      />
    </svg>
  )
}
