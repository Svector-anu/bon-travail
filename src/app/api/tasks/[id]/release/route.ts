import { getApp } from '@/server/container'
import { handle, json, requireAgent } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

export const maxDuration = 60

/** Pays an ACCEPTED task. The verdict came from the verifier; this cannot pay anything it did not accept. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAgent(request)
    const { id } = await params
    await (await getApp()).tasks.releasePayment(id, 'agent:api')
    return json(await getTaskDetail(id))
  })
}
