import { getApp } from '@/server/container'
import { handle, json, requireOwnerRequest } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

/** Takes a stalled claim back so another approved contributor can pick the work up. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireOwnerRequest(request)
    const { id } = await params
    await (await getApp()).work.releaseClaim(id, actor)
    return json(await getTaskDetail(id))
  })
}
