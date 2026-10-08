import { requireRepoAccess } from '@/server/access'
import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { field, handle, json, readBody, requireConsoleRequest } from '@/server/http'

export const maxDuration = 60

/** "Check now": the same observation the agent tick runs, on demand. */
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireConsoleRequest(request)
    const { watch, work } = await getApp()
    const repo = await watch.getRepo(field(await readBody(request), 'repoId', 140))
    if (!repo) throw new DomainError('NOT_FOUND', 'repository not found')
    requireRepoAccess(viewer, repo.owner, 'repository')
    return json({ report: await work.observe(repo) })
  })
}
