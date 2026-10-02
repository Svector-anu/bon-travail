import { isTxHash } from '@/domain/address'
import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { field, handle, json, readBody, requireAgent } from '@/server/http'
import { getTaskDetail, listTaskViews } from '@/server/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(() => json({ tasks: listTaskViews() }))
}

/** Agent-only: create, fund and publish a task for a specific transaction. */
export async function POST(request: Request) {
  return handle(async () => {
    requireAgent(request)
    const txHash = field(await readBody(request), 'txHash', 66)
    if (!isTxHash(txHash)) throw new DomainError('BAD_REQUEST', 'txHash must be 0x + 64 hex characters')
    const { tasks } = getApp()
    const draft = await tasks.createTask(txHash, 'agent:api')
    await tasks.fundTask(draft.id, 'agent:api')
    tasks.publishTask(draft.id, 'agent:api')
    return json(getTaskDetail(draft.id), 201)
  })
}
