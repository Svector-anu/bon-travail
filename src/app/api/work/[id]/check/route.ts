import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { handle, json } from '@/server/http'
import { throttle } from '@/server/throttle'
import { getTaskDetail } from '@/server/queries'

export const maxDuration = 60

const CHECK_SPACING_MS = 15_000

/**
 * "Check again" for a submitted work package. Verification is idempotent and
 * decided by GitHub, so anyone may ask; a short lease keeps it from being
 * used to burn the GitHub rate limit.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const { store, agent, clock } = await getApp()
    const task = await store.requireTask(id)
    if (task.kind !== 'ci-fix') throw new DomainError('BAD_REQUEST', `${id} is not a work package`)
    if (task.state !== 'SUBMITTED' && task.state !== 'ACCEPTED') throw new DomainError('CONFLICT', `${id} is ${task.state}; nothing to check`)
    await throttle({ store, clock }, `check:${id}`, CHECK_SPACING_MS)
    await agent.onSubmission(id)
    return json(await getTaskDetail(id))
  })
}
