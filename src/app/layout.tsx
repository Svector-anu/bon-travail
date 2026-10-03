import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: { default: 'Bon Travail · Verified work, paid in USDC', template: '%s | Bon Travail' },
  description: 'An autonomous agent pays humans in USDC for machine-verified onchain fact checks.',
  icons: { icon: '/mascots/seedling.png' },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <Header />
            <main className="main">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  )
}
