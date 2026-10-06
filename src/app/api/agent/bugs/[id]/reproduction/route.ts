import { getApp } from '@/server/container'
import { handle, json, readBody, requireAgent } from '@/server/http'
import { parseReproduction } from '@/server/services/work-service'

/**
 * Aeon hands over the test that reproduces a reported bug, or says why it
 * could not. Like an investigation, it describes; it never approves or pays.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAgent(request)
    const { id } = await params
    const app = await getApp()
    const { report, finding } = await app.work.recordReproduction(id, parseReproduction(await readBody(request)), 'aeon:reproducer')
    return json({ id: report.id, status: report.status, findingId: finding?.id ?? null })
  })
}
