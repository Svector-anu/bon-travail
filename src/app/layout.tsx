import './globals.css'
import type { Metadata } from 'next'
import { Inter, Instrument_Serif } from 'next/font/google'
import type { ReactNode } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Providers } from '@/components/providers'
import { SmoothScroll } from '@/components/smooth-scroll'
import { isOwnerSession } from '@/server/owner-session'
import { escrowExplorerUrl } from '@/server/queries'

/** Two faces, one role each: Instrument Serif for every title and big number, Inter for everything else. */
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-serif', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bon-travail.vercel.app'),
  title: { default: 'bon travail · agents find broken code and pay humans to fix it', template: '%s · bon travail' },
  description:
    'An agent spots tests that keep failing and works out why. Engineers decide who fixes it. When the fix passes the project\'s tests, the contributor is paid in USDC automatically.',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [owner, escrowUrl] = await Promise.all([isOwnerSession().catch(() => false), escrowExplorerUrl().catch(() => null)])
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <SmoothScroll />
        <Providers>
          <div className="shell">
            <Header owner={owner} />
            <main className="main">{children}</main>
            <Footer escrowUrl={escrowUrl} />
          </div>
        </Providers>
      </body>
    </html>
  )
}
