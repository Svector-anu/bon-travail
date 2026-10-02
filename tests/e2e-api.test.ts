import { beforeAll, describe, expect, it } from 'vitest'
import { formatUsdc } from '@/domain/money'
import type { ReceiptView, TaskView, TickReport } from '@/domain/views'
import { ARC_TESTNET_FIXTURES } from '@/server/chain/fixture-reader'
import { TEST_ENV } from './helpers'

/**
 * Drives the real route handlers in order, the way the browser and Aeon do:
 * agent tick -> claim -> submit (verify + pay inline) -> receipt -> next tick.
 */

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

let routes: {
  tick: (request: Request) => Promise<Response>
  claim: Handler
  submit: Handler
  receipt: Handler
  activity: (request: Request) => Promise<Response>
}

const token = TEST_ENV.AGENT_API_TOKEN
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://test.local', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeAll(async () => {
  Object.assign(process.env, TEST_ENV)
  routes = {
    tick: (await import('@/app/api/agent/tick/route')).POST,
    claim: (await import('@/app/api/tasks/[id]/claim/route')).POST,
    submit: (await import('@/app/api/tasks/[id]/submit/route')).POST,
    receipt: (await import('@/app/api/receipts/[id]/route')).GET,
    activity: (await import('@/app/api/agent/activity/route')).GET,
  }
})

describe('happy path over HTTP', () => {
  const worker = '0x9a9A9a9A9A9A9a9a9A9A9a9a9a9A9A9a9a9a9a9A'.toLowerCase()
  const fixture = ARC_TESTNET_FIXTURES[0]!

  it('rejects an agent tick without the token', async () => {
    // #given no Authorization header
    // #when the tick endpoint is called
    const res = await routes.tick(post({ source: 'aeon' }))
    // #then it refuses
    expect(res.status).toBe(401)
  })

  it('creates a task, pays a correct answer, freezes a receipt and posts the next task', async () => {
    // #given the agent publishes the first task
    const first = (await (await routes.tick(post({ source: 'aeon' }, { authorization: `Bearer ${token}` }))).json()) as TickReport
    expect(first.openTasks).toEqual(['task_001'])

    // #when a worker claims and submits the on-chain values
    const claimRes = await routes.claim(post({ wallet: worker }), ctx('task_001'))
    expect(claimRes.status).toBe(200)
    const claim = (await claimRes.json()) as { claimId: string; claimToken: string; task: TaskView }
    expect(claim.task.state).toBe('CLAIMED')

    const duplicate = await routes.claim(post({ wallet: '0x8888888888888888888888888888888888888888' }), ctx('task_001'))
    expect(duplicate.status).toBe(409)

    const submitRes = await routes.submit(
      post({
        claimId: claim.claimId,
        claimToken: claim.claimToken,
        recipient: fixture.recipient,
        amount: formatUsdc(fixture.amountMicro),
      }),
      ctx('task_001'),
    )
    const submitted = (await submitRes.json()) as { task: TaskView; receiptUrl: string }

    // #then it is verified and paid in the same request
    expect(submitRes.status).toBe(200)
    expect(submitted.task.state).toBe('PAID')
    expect(submitted.receiptUrl).toBe('https://proofwork.test/receipt/task_001')

    // #then the public receipt is frozen and complete
    const receipt = (await (await routes.receipt(new Request('http://test.local'), ctx('task_001'))).json()) as ReceiptView
    expect(receipt).toMatchObject({ final: true, outcome: 'PAID', worker: expect.stringMatching(/^0x9a9a/i) })
    expect(receipt.task.expected?.recipient).toBe(fixture.recipient)
    expect(receipt.payout?.txHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(receipt.timeline.map((t) => t.label)).toEqual([
      'Created',
      'Funded',
      'Published',
      'Claimed',
      'Submitted',
      'Verifying',
      'Verified',
      'Paid',
    ])

    // #then the next scheduled tick posts a new task without anyone asking
    const next = (await (await routes.tick(post({ source: 'aeon' }, { authorization: `Bearer ${token}` }))).json()) as TickReport
    expect(next.openTasks).toEqual(['task_002'])

    const activity = (await (await routes.activity(new Request('http://test.local/api/agent/activity'))).json()) as {
      runs: { action: string; source: string }[]
    }
    expect(activity.runs.some((r) => r.action === 'pay' && r.source === 'worker-event')).toBe(true)
    expect(activity.runs.some((r) => r.action === 'create_task' && r.source === 'aeon')).toBe(true)
  })

  it('returns 404 for an unknown receipt', async () => {
    const res = await routes.receipt(new Request('http://test.local'), ctx('task_999'))
    expect(res.status).toBe(404)
  })
})
