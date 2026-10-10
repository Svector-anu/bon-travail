import { getApp } from '@/server/container'
import { field, handle, json, optionalField, readBody, requireConsoleRequest } from '@/server/http'
import { toRepoView } from '@/server/services/views'

export const maxDuration = 60

/** Connects a repository and watches one of its workflows. Reads only; never writes to the repo. */
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireConsoleRequest(request)
    const body = await readBody(request)
    const { work } = await getApp()
    const { repo, report } = await work.connectRepo(field(body, 'repo', 140), optionalField(body, 'workflow', 200), viewer)
    return json({ repo: toRepoView(repo), report }, 201)
  })
}
