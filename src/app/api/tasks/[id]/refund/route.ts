import { getApp } from '@/server/container'
import { handle, json, requireAgent } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

/** Expires an overdue OPEN task if needed, then refunds it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAgent(request)
    const { id } = await params
    const { tasks, store } = getApp()
    if (store.requireTask(id).state === 'OPEN') tasks.expireTask(id, 'agent:api')
    await tasks.refundTask(id, 'agent:api')
    return json(getTaskDetail(id))
  })
}
