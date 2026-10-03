import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { REPO_SLUG } from '@/server/github/client'
import { handle, json, requireOwnerRequest } from '@/server/http'

export const dynamic = 'force-dynamic'

/** The active workflows of a repository, so the engineer can pick which one to watch. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireOwnerRequest(request)
    const match = REPO_SLUG.exec(new URL(request.url).searchParams.get('repo') ?? '')
    if (!match) throw new DomainError('BAD_REQUEST', 'repo must look like owner/name')
    const { github } = await getApp()
    if (!github) throw new DomainError('UNAVAILABLE', 'GitHub is not connected in this deployment')
    const workflows = (await github.listWorkflows(match[1]!, match[2]!)).filter((w) => w.state === 'active')
    return json({ workflows: workflows.map((w) => ({ name: w.name, path: w.path })) })
  })
}
