import { getApp } from '@/server/container'
import { throttle } from '@/server/throttle'
import { field, handle, json, readBody } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

export const maxDuration = 60

/**
 * Hands the claimed PR to the verifier and checks it right away. Usually the
 * answer is "waiting on GitHub Actions"; the agent tick picks it up from there.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const app = await getApp()
    const { work, agent } = app
    await throttle(app, `submit:${id}`)
    await work.submitPullRequest(id, field(await readBody(request), 'prUrl', 300))
    await agent.onSubmission(id)
    return json(await getTaskDetail(id))
  })
}
