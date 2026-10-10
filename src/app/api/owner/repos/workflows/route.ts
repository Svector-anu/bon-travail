import { requireRepoAccess } from '@/server/access'
import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { REPO_SLUG } from '@/server/github/client'
import { workflowSetup } from '@/server/github/workflow-setup'
import { handle, json, requireConsoleRequest } from '@/server/http'

export const dynamic = 'force-dynamic'

/**
 * The active workflows of a repository, so the engineer can pick which one to watch.
 * With none, the way to get one: a starter workflow for the repo's stack, or for a fork, where to switch its workflows on.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const viewer = await requireConsoleRequest(request)
    const match = REPO_SLUG.exec(new URL(request.url).searchParams.get('repo') ?? '')
    if (!match) throw new DomainError('BAD_REQUEST', 'repo must look like owner/name')
    requireRepoAccess(viewer, match[1]!, match[2]!, `${match[1]}/${match[2]}`)
    const { github } = await getApp()
    if (!github) throw new DomainError('UNAVAILABLE', 'GitHub is not connected in this deployment')
    const workflows = (await github.listWorkflows(match[1]!, match[2]!)).filter((w) => w.state === 'active')
    if (workflows.length === 0) return json({ workflows: [], setup: await workflowSetup(github, match[1]!, match[2]!) })
    return json({ workflows: workflows.map((w) => ({ name: w.name, path: w.path })) })
  })
}
