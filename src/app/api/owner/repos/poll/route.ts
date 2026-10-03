import { getApp } from '@/server/container'
import { field, handle, json, readBody, requireOwnerRequest } from '@/server/http'

export const maxDuration = 60

/** "Check now": the same observation the agent tick runs, on demand. */
export async function POST(request: Request) {
  return handle(async () => {
    await requireOwnerRequest(request)
    const { watch, work } = await getApp()
    const repo = await watch.requireRepo(field(await readBody(request), 'repoId', 140))
    return json({ report: await work.observe(repo) })
  })
}
