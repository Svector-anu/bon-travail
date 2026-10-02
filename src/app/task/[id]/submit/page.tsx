import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Reveal } from '@/components/reveal'
import { SubmitMission } from '@/components/submit-mission'
import { getTaskDetail } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Submit answer' }

export default async function SubmitPage({ params }: { params: Promise<{ id: string }> }) {
  const detail = getTaskDetail((await params).id)
  if (!detail) notFound()

  return (
    <Reveal>
      <section className="mission">
        <div className="mission-media" aria-hidden>
          <img src="/scenes/monolith-tall.jpg" alt="" />
        </div>
        <SubmitMission task={detail.task} attempts={detail.attempts} />
      </section>
    </Reveal>
  )
}
