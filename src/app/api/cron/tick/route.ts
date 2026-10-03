import { timingSafeEqual } from 'node:crypto'
import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { handle, json } from '@/server/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Vercel Cron fallback for the Aeon schedule. Vercel sends CRON_SECRET as a bearer token. */
export async function GET(request: Request) {
  return handle(async () => {
    const app = await getApp()
    const secret = app.config.cronSecret
    if (!secret) throw new DomainError('UNAVAILABLE', 'CRON_SECRET is not configured')
    const presented = Buffer.from(request.headers.get('authorization') ?? '')
    const expected = Buffer.from(`Bearer ${secret}`)
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new DomainError('UNAUTHORIZED', 'Not a Vercel cron call')
    }
    const report = await app.agent.tick('cron')
    return json({ status: report.status, actions: report.actions.length, notable: report.notable.length })
  })
}
