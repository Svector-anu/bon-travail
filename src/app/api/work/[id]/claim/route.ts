import { getApp } from '@/server/container'
import { field, handle, json, readBody } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

/**
 * Claims a work package with a pull request. No login: GitHub already proves
 * who opened the PR, and only an approved login can hold the claim.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    await (await getApp()).work.claimWithPullRequest(id, field(await readBody(request), 'prUrl', 300))
    return json(await getTaskDetail(id))
  })
}
