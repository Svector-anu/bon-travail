import './globals.css'
import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import type { ReactNode } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Providers } from '@/components/providers'
import { SmoothScroll } from '@/components/smooth-scroll'
import { isOwnerSession } from '@/server/owner-session'

/** Thin, airy display face for large statements; body text keeps the system sans. */
const display = Geist({ subsets: ['latin'], weight: ['200', '300', '400'], variable: '--font-display', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Bon Travail · Agents find the work, people fix it, proof pays', template: '%s | Bon Travail' },
  description:
    'An agent spots tests that keep failing and works out why. Engineers decide who fixes it. When the fix passes the project\'s tests, the contributor is paid in USDC automatically.',
  icons: { icon: '/mascots/seedling.png' },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const owner = await isOwnerSession().catch(() => false)
  return (
    <html lang="en" className={display.variable}>
      <body>
        <SmoothScroll />
        <Providers>
          <div className="shell">
            <Header owner={owner} />
            <main className="main">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  )
}
