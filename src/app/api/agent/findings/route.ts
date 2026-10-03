import { INVESTIGABLE, type FindingStatus } from '@/domain/findings'
import { DomainError } from '@/server/errors'
import { handle, json, requireAgent } from '@/server/http'
import { findingsForInvestigation } from '@/server/queries'

export const dynamic = 'force-dynamic'

/** Aeon reads the findings that want an investigation, with what it needs to reproduce them. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAgent(request)
    const requested = (new URL(request.url).searchParams.get('status') ?? 'candidate,recurred').split(',')
    const statuses = requested.filter((s): s is FindingStatus => (INVESTIGABLE as readonly string[]).includes(s))
    if (statuses.length === 0) throw new DomainError('BAD_REQUEST', `status must be one of ${INVESTIGABLE.join(', ')}`)
    return json({ findings: await findingsForInvestigation(statuses) })
  })
}
