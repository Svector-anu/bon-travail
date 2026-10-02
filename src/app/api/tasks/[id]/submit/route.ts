import { getApp } from '@/server/container'
import { field, handle, json, readBody } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

/**
 * Records the answer, then lets the agent verify and pay immediately so the
 * worker sees the verdict in the same request. If the chain or payout rail is
 * down the task stays SUBMITTED/ACCEPTED and the next agent tick finishes it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const body = await readBody(request)
    const { tasks, agent, config } = getApp()
    tasks.submitTask(id, {
      claimId: field(body, 'claimId', 64),
      claimToken: field(body, 'claimToken', 64),
      recipient: field(body, 'recipient', 64),
      amount: field(body, 'amount', 32),
    })
    await agent.onSubmission(id)
    return json({ ...getTaskDetail(id), receiptUrl: `${config.publicBaseUrl}/receipt/${id}` })
  })
}
