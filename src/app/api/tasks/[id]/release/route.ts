import { getApp } from '@/server/container'
import { handle, json, requireAgent } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAgent(request)
    const { id } = await params
    await getApp().tasks.releasePayment(id, 'agent:api')
    return json(getTaskDetail(id))
  })
}
