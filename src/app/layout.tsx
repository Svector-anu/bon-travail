import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import '@fontsource/pacifico/400.css'
import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Toasts } from '@/components/toasts'
import { THEME_BOOTSTRAP } from '@/lib/theme'

export const metadata: Metadata = {
  title: { default: 'Proofwork', template: '%s | Proofwork' },
  description: 'An autonomous agent pays humans in USDC for machine-verified onchain fact checks.',
  icons: { icon: '/mascots/seedling.png' },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <div className="shell">
          <Header />
          <main className="main">{children}</main>
          <Footer />
        </div>
        <Toasts />
      </body>
    </html>
  )
}
