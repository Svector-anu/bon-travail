import { getApp } from '@/server/container'
import { field, handle, json, readBody } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

/** Rail-test claim with a wallet. Work packages are claimed at /api/work/[id]/claim with a PR. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const wallet = field(await readBody(request), 'wallet', 42)
    const app = await getApp()
    const identity = await app.identity.verify(request)
    const claim = await app.tasks.claimTask(id, wallet, identity)
    return json({
      claimId: claim.claimId,
      claimToken: claim.claimToken,
      claimExpiresAt: claim.claimExpiresAt,
      ...(await getTaskDetail(id)),
    })
  })
}
