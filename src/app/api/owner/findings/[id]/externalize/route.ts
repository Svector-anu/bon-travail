import { getApp } from '@/server/container'
import { handle, json, readBody, requireOwnerRequest } from '@/server/http'
import { getTaskDetail } from '@/server/queries'
import type { ExternalizeInput } from '@/server/services/work-service'

export const maxDuration = 60

/** The engineer's approval: reward, deadline, allowlist, acceptance and scope. Funds move into escrow here. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireOwnerRequest(request)
    const { id } = await params
    const body = await readBody(request)
    const input: ExternalizeInput = {
      reward: String(body.reward ?? ''),
      deadlineHours: Number(body.deadlineHours),
      contributors: Array.isArray(body.contributors) ? (body.contributors as ExternalizeInput['contributors']) : [],
      openToAnyone: body.openToAnyone === true,
      bonus: body.bonus == null ? undefined : String(body.bonus),
      acceptance: String(body.acceptance ?? ''),
      scope: String(body.scope ?? ''),
      protectedPaths: Array.isArray(body.protectedPaths) ? body.protectedPaths.map(String) : [],
      requireMerge: body.requireMerge !== false,
    }
    const task = await (await getApp()).work.externalize(id, input, actor)
    return json(await getTaskDetail(task.id), 201)
  })
}
