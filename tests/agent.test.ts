import { describe, expect, it } from 'vitest'
import { ARC_TESTNET_FIXTURES } from '@/server/chain/fixture-reader'
import { FIXTURE, FlakyRail, SwitchableChain, WORKER_A, claimAndSubmit, correctAnswer, makeApp } from './helpers'

const HOUR = 60 * 60 * 1000

describe('agent tick', () => {
  it('creates, funds and publishes the next task when none is open', async () => {
    const app = makeApp()
    const report = await app.agent.tick('aeon')
    expect(report.status).toBe('ok')
    expect(report.actions.map((a) => a.action)).toEqual(['create_task', 'fund', 'publish'])
    expect(report.openTasks).toEqual(['task_001'])
    expect(app.store.requireTask('task_001')).toMatchObject({ state: 'OPEN', txHash: FIXTURE.hash })
    expect(report.notable[0]).toContain('New task TASK-001')
  })

  it('does nothing when the supply is already met', async () => {
    const app = makeApp()
    await app.agent.tick('aeon')
    const second = await app.agent.tick('aeon')
    expect(second.actions).toEqual([])
    expect(second.notable).toEqual([])
    expect(app.store.listTasks()).toHaveLength(1)
  })

  it('verifies, pays and then creates the next task in one tick', async () => {
    const app = makeApp()
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, correctAnswer())
    const report = await app.agent.tick('aeon')
    expect(report.actions.map((a) => `${a.action}:${a.result}`)).toEqual([
      'verify:ok',
      'pay:ok',
      'create_task:ok',
      'fund:ok',
      'publish:ok',
    ])
    expect(app.store.requireTask('task_001').state).toBe('PAID')
    expect(app.store.requireTask('task_002')).toMatchObject({ state: 'OPEN', txHash: ARC_TESTNET_FIXTURES[1]!.hash })
  })

  it('leaves an already-settled task alone', async () => {
    const app = makeApp()
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, correctAnswer())
    await app.agent.onSubmission('task_001')
    expect(app.store.requireTask('task_001').state).toBe('PAID')

    const eventsBefore = app.store.listEvents('task_001').length
    const report = await app.agent.tick('aeon')
    expect(report.actions.filter((a) => a.taskId === 'task_001')).toEqual([])
    expect(app.store.listEvents('task_001')).toHaveLength(eventsBefore)
    expect(app.store.listPayments('task_001').filter((p) => p.kind === 'release')).toHaveLength(1)
  })

  it('reopens a rejected task', async () => {
    const app = makeApp()
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, { recipient: FIXTURE.recipient, amount: '0.01' })
    const report = await app.agent.tick('aeon')
    expect(report.actions.map((a) => a.action)).toEqual(['verify', 'reopen'])
    expect(app.store.requireTask('task_001').state).toBe('OPEN')
  })

  it('expires and refunds an overdue task, then replaces it', async () => {
    const app = makeApp()
    await app.agent.tick('aeon')
    app.clock.advance(6 * HOUR)
    const report = await app.agent.tick('aeon')
    expect(report.actions.map((a) => a.action)).toEqual(['expire', 'refund', 'create_task', 'fund', 'publish'])
    expect(app.store.requireTask('task_001').state).toBe('REFUNDED')
    expect(app.tasks.getReceipt('task_001')).toMatchObject({ final: true, outcome: 'REFUNDED' })
  })

  it('recovers from a failed payout on a later tick', async () => {
    const rail = new FlakyRail(1)
    const app = makeApp({ rail })
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, correctAnswer())

    const failing = await app.agent.tick('aeon')
    expect(failing.status).toBe('error')
    expect(failing.actions.find((a) => a.action === 'pay')).toMatchObject({ result: 'error', error: 'simulated rpc timeout' })
    expect(app.store.requireTask('task_001').state).toBe('ACCEPTED')
    expect(failing.notable.some((n) => n.includes('Agent error'))).toBe(true)

    const recovered = await app.agent.tick('aeon')
    expect(recovered.status).toBe('ok')
    expect(app.store.requireTask('task_001').state).toBe('PAID')
    expect(rail.signs).toBe(1)
  })

  it('recovers from an RPC outage during verification', async () => {
    const chain = new SwitchableChain()
    const app = makeApp({ chain })
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, correctAnswer())

    chain.down = true
    const failing = await app.agent.tick('aeon')
    expect(failing.actions.find((a) => a.action === 'verify')?.result).toBe('error')
    expect(app.store.requireTask('task_001').state).toBe('SUBMITTED')

    chain.down = false
    await app.agent.tick('aeon')
    expect(app.store.requireTask('task_001').state).toBe('PAID')
    expect(app.store.listAttempts('task_001')[0]?.outcome).toBe('PASS')
  })

  it('does not run two ticks at once', async () => {
    const app = makeApp()
    app.store.acquireLease('agent-tick', 'someone-else', app.clock.now(), 60_000)
    const report = await app.agent.tick('aeon')
    expect(report.status).toBe('skipped')
    expect(app.agent.status().health).toBe('running')
  })

  it('reports health from real tick history', async () => {
    const app = makeApp()
    expect(app.agent.status().health).toBe('never')
    await app.agent.tick('aeon')
    expect(app.agent.status()).toMatchObject({ health: 'alive', lastTickSource: 'aeon', simulatedPayments: true })
    app.clock.advance(11 * 60 * 1000)
    expect(app.agent.status().health).toBe('stale')
  })
})

describe('agent tick with no chain access', () => {
  it('logs the failed task sourcing and creates the task once the RPC is back', async () => {
    const chain = new SwitchableChain()
    const app = makeApp({ chain })
    chain.down = true
    const failing = await app.agent.tick('aeon')
    expect(failing.status).toBe('error')
    expect(failing.actions).toEqual([
      expect.objectContaining({ action: 'source_task', result: 'error', error: 'rpc down' }),
    ])
    expect(app.agent.status().health).toBe('error')

    chain.down = false
    const recovered = await app.agent.tick('aeon')
    expect(recovered.openTasks).toEqual(['task_001'])
    expect(app.agent.status().health).toBe('alive')
  })
})
