import './globals.css'
import type { Metadata } from 'next'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Providers } from '@/components/providers'
import { SmoothScroll } from '@/components/smooth-scroll'
import { isOwnerSession } from '@/server/owner-session'

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

export const metadata: Metadata = {
  title: { default: 'bon travail · agents find the work, people fix it, proof pays', template: '%s · bon travail' },
  description:
    'An agent spots tests that keep failing and works out why. Engineers decide who fixes it. When the fix passes the project\'s tests, the contributor is paid in USDC automatically.',
  icons: { icon: '/mascots/seedling.png' },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const owner = await isOwnerSession().catch(() => false)
  return (
    <html lang="en" className={sans.variable}>
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
