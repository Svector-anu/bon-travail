import type { Metadata } from 'next'
import { YourPage } from '@/components/your-page'

export const metadata: Metadata = { title: 'Your page' }

export default function YouPage() {
  return (
    <section className="page">
      <img className="hero-mark" src="/mascots/turnip.png" alt="" />
      <h1>Your Page</h1>
      <p className="lede">Everything your wallet earned on Proofwork.</p>
      <YourPage />
    </section>
  )
}
