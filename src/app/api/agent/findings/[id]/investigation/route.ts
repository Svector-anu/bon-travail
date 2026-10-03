import { getApp } from '@/server/container'
import { handle, json, readBody, requireAgent } from '@/server/http'
import { parseInvestigation } from '@/server/services/work-service'

/**
 * Aeon attaches what it learned by reproducing the failure. This is the only
 * write Aeon has on a finding: it cannot approve, set a reward or pick people.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAgent(request)
    const { id } = await params
    const app = await getApp()
    const investigation = parseInvestigation(await readBody(request), app.clock.now())
    const finding = await app.work.recordInvestigation(id, investigation, 'aeon:investigator')
    return json({ id: finding.id, status: finding.status })
  })
}
