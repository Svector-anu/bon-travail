import type { Metadata } from 'next'
import { Reveal } from '@/components/reveal'
import { YourPage } from '@/components/your-page'

export const metadata: Metadata = { title: 'You' }

export default function YouPage() {
  return (
    <Reveal>
      <div className="page-head">
        <div>
          <h1>You</h1>
          <p>What your wallet has earned on Bon Travail.</p>
        </div>
      </div>
      <YourPage />
    </Reveal>
  )
}
