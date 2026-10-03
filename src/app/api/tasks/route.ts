import { isTxHash } from '@/domain/address'
import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { field, handle, json, readBody, requireAgent } from '@/server/http'
import { getTaskDetail, listTaskViews } from '@/server/queries'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  return handle(async () => json({ tasks: await listTaskViews() }))
}

/** Agent-only rail test: create, fund and publish a task for a specific Arc transaction. */
export async function POST(request: Request) {
  return handle(async () => {
    await requireAgent(request)
    const txHash = field(await readBody(request), 'txHash', 66)
    if (!isTxHash(txHash)) throw new DomainError('BAD_REQUEST', 'txHash must be 0x + 64 hex characters')
    const { tasks } = await getApp()
    const draft = await tasks.createTask(txHash, 'agent:api')
    await tasks.fundTask(draft.id, 'agent:api')
    await tasks.publishTask(draft.id, 'agent:api')
    return json(await getTaskDetail(draft.id), 201)
  })
}
