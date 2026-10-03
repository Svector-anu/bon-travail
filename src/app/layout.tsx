import './globals.css'
import type { Metadata } from 'next'
import { Geist, Italiana } from 'next/font/google'
import type { ReactNode } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Providers } from '@/components/providers'
import { SmoothScroll } from '@/components/smooth-scroll'
import { isOwnerSession } from '@/server/owner-session'

/** Two families: a hairline display face for the brand and statements, a neutral sans for everything people read or press. */
const display = Italiana({ subsets: ['latin'], weight: '400', variable: '--font-display', display: 'swap' })
const body = Geist({ subsets: ['latin'], variable: '--font-body', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'bon travail · agents find the work, people fix it, proof pays', template: '%s · bon travail' },
  description:
    'An agent spots tests that keep failing and works out why. Engineers decide who fixes it. When the fix passes the project\'s tests, the contributor is paid in USDC automatically.',
  icons: { icon: '/mascots/seedling.png' },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const owner = await isOwnerSession().catch(() => false)
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
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
