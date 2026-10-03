import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Providers } from '@/components/providers'
import { isOwnerSession } from '@/server/owner-session'

export const metadata: Metadata = {
  title: { default: 'Bon Travail · Agents find the work, people fix it, proof pays', template: '%s | Bon Travail' },
  description:
    'Aeon watches your CI, reproduces what keeps breaking and prepares the work. Engineers decide who fixes it. GitHub Actions verifies; USDC settles on Arc.',
  icons: { icon: '/mascots/seedling.png' },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const owner = await isOwnerSession().catch(() => false)
  return (
    <html lang="en">
      <body>
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
