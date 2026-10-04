import './globals.css'
import type { Metadata } from 'next'
import { Cormorant_Garamond } from 'next/font/google'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Providers } from '@/components/providers'
import { SmoothScroll } from '@/components/smooth-scroll'
import { isOwnerSession } from '@/server/owner-session'
import { escrowExplorerUrl } from '@/server/queries'

/** Open Runde (Inter with rounded terminals, SIL OFL): one clear family for the brand, statements and body. */
const sans = localFont({
  src: [
    { path: './fonts/OpenRunde-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/OpenRunde-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/OpenRunde-Semibold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
})

/** The editorial serif, the same cut as the footer wordmark, kept to a few large headlines. */
const serif = Cormorant_Garamond({ subsets: ['latin'], weight: '500', variable: '--font-serif', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'bon travail · agents find broken code and pay humans to fix it', template: '%s · bon travail' },
  description:
    'An agent spots tests that keep failing and works out why. Engineers decide who fixes it. When the fix passes the project\'s tests, the contributor is paid in USDC automatically.',
  icons: { icon: '/mascots/seedling.png' },
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
