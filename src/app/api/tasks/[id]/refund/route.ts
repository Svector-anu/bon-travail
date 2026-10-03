import { getApp } from '@/server/container'
import { handle, json, requireAgent } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

export const maxDuration = 60

/** Expires an overdue OPEN task if needed, then refunds it. Refuses anything before its deadline. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAgent(request)
    const { id } = await params
    const { tasks, store } = await getApp()
    if ((await store.requireTask(id)).state === 'OPEN') await tasks.expireTask(id, 'agent:api')
    await tasks.refundTask(id, 'agent:api')
    return json(await getTaskDetail(id))
  })
}
