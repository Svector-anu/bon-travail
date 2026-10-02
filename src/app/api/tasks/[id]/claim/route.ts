import { getApp } from '@/server/container'
import { field, handle, json, readBody } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const wallet = field(await readBody(request), 'wallet', 42)
    const claim = getApp().tasks.claimTask(id, wallet)
    return json({
      claimId: claim.claimId,
      claimToken: claim.claimToken,
      claimExpiresAt: claim.claimExpiresAt,
      ...getTaskDetail(id),
    })
  })
}
