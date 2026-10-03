import { getApp } from '@/server/container'
import { throttle } from '@/server/throttle'
import { field, handle, json, readBody } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

/**
 * Claims a work package with a pull request. No login: GitHub already proves
 * who opened the PR, and only an approved login can hold the claim.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const app = await getApp()
    await throttle(app, `claim:${id}`)
    await app.work.claimWithPullRequest(id, field(await readBody(request), 'prUrl', 300))
    return json(await getTaskDetail(id))
  })
}
