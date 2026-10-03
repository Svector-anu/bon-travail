import { describe, expect, it } from 'vitest'
import { ARC_TESTNET_FIXTURES } from '@/server/chain/fixture-reader'
import { FIXTURE, FlakyRail, SwitchableChain, WORKER_A, claimAndSubmit, correctAnswer, makeApp } from './helpers'

const HOUR = 60 * 60 * 1000

describe('agent tick', () => {
  it('creates, funds and publishes the next task when none is open', async () => {
    // #given
    const app = await makeApp()
    // #when
    const report = await app.agent.tick('aeon')
    // #then
    expect(report.status).toBe('ok')
    expect(report.actions.map((a) => a.action)).toEqual(['create_task', 'fund', 'publish'])
    expect(report.openTasks).toEqual(['task_001'])
    expect(await app.store.requireTask('task_001')).toMatchObject({ state: 'OPEN', subject: FIXTURE.hash })
    expect(report.notable[0]).toContain('New task TASK-001')
  })

  it('does nothing when the supply is already met', async () => {
    // #given a published task
    const app = await makeApp()
    await app.agent.tick('aeon')
    // #when
    const second = await app.agent.tick('aeon')
    // #then
    expect(second.actions).toEqual([])
    expect(second.notable).toEqual([])
    expect(await app.store.listTasks()).toHaveLength(1)
  })

  it('verifies, pays and then creates the next task in one tick', async () => {
    // #given a submitted correct answer
    const app = await makeApp()
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, correctAnswer())
    // #when
    const report = await app.agent.tick('aeon')
    // #then
    expect(report.actions.map((a) => `${a.action}:${a.result}`)).toEqual([
      'verify:ok',
      'pay:ok',
      'create_task:ok',
      'fund:ok',
      'publish:ok',
    ])
    expect((await app.store.requireTask('task_001')).state).toBe('PAID')
    expect(await app.store.requireTask('task_002')).toMatchObject({ state: 'OPEN', subject: ARC_TESTNET_FIXTURES[1]!.hash })
  })

  it('leaves an already-settled task alone', async () => {
    // #given a paid task
    const app = await makeApp()
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, correctAnswer())
    await app.agent.onSubmission('task_001')
    expect((await app.store.requireTask('task_001')).state).toBe('PAID')

    const eventsBefore = (await app.store.listEvents('task_001')).length
    // #when
    const report = await app.agent.tick('aeon')
    // #then
    expect(report.actions.filter((a) => a.taskId === 'task_001')).toEqual([])
    expect(await app.store.listEvents('task_001')).toHaveLength(eventsBefore)
    expect((await app.store.listPayments('task_001')).filter((p) => p.kind === 'release')).toHaveLength(1)
  })

  it('reopens a rejected task', async () => {
    // #given a submitted wrong answer
    const app = await makeApp()
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, { recipient: FIXTURE.recipient, amount: '0.01' })
    // #when
    const report = await app.agent.tick('aeon')
    // #then
    expect(report.actions.map((a) => a.action)).toEqual(['verify', 'reopen'])
    expect((await app.store.requireTask('task_001')).state).toBe('OPEN')
  })

  it('expires and refunds an overdue task, then replaces it', async () => {
    // #given an overdue task
    const app = await makeApp()
    await app.agent.tick('aeon')
    app.clock.advance(6 * HOUR)
    // #when
    const report = await app.agent.tick('aeon')
    // #then
    expect(report.actions.map((a) => a.action)).toEqual(['expire', 'refund', 'create_task', 'fund', 'publish'])
    expect((await app.store.requireTask('task_001')).state).toBe('REFUNDED')
    expect(await app.tasks.getReceipt('task_001')).toMatchObject({ final: true, outcome: 'REFUNDED' })
  })

  it('recovers from a failed payout on a later tick', async () => {
    // #given a rail that fails once
    const rail = new FlakyRail(1)
    const app = await makeApp({ rail })
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, correctAnswer())

    // #when
    const failing = await app.agent.tick('aeon')
    // #then
    expect(failing.status).toBe('error')
    expect(failing.actions.find((a) => a.action === 'pay')).toMatchObject({ result: 'error', error: 'simulated rpc timeout' })
    expect((await app.store.requireTask('task_001')).state).toBe('ACCEPTED')
    expect(failing.notable.some((n) => n.includes('Agent error'))).toBe(true)

    // #when the next tick runs
    const recovered = await app.agent.tick('aeon')
    // #then
    expect(recovered.status).toBe('ok')
    expect((await app.store.requireTask('task_001')).state).toBe('PAID')
    expect(rail.signs).toBe(1)
  })

  it('recovers from an RPC outage during verification', async () => {
    // #given a submitted answer
    const chain = new SwitchableChain()
    const app = await makeApp({ chain })
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, correctAnswer())

    // #when the chain is down
    chain.down = true
    const failing = await app.agent.tick('aeon')
    // #then
    expect(failing.actions.find((a) => a.action === 'verify')?.result).toBe('error')
    expect((await app.store.requireTask('task_001')).state).toBe('SUBMITTED')

    // #when the chain is back
    chain.down = false
    await app.agent.tick('aeon')
    // #then
    expect((await app.store.requireTask('task_001')).state).toBe('PAID')
    expect((await app.store.listAttempts('task_001'))[0]?.outcome).toBe('PASS')
  })

  it('does not run two ticks at once', async () => {
    // #given a lease held elsewhere
    const app = await makeApp()
    await app.store.acquireLease('agent-tick', 'someone-else', app.clock.now(), 60_000)
    // #when
    const report = await app.agent.tick('aeon')
    // #then
    expect(report.status).toBe('skipped')
    expect((await app.agent.status()).health).toBe('running')
  })

  it('reports health from real tick history', async () => {
    // #given
    const app = await makeApp()
    // #then never ticked
    expect((await app.agent.status()).health).toBe('never')
    // #when a tick runs
    await app.agent.tick('aeon')
    // #then
    expect(await app.agent.status()).toMatchObject({ health: 'alive', lastTickSource: 'aeon', simulatedPayments: true })
    // #when the tick goes stale
    app.clock.advance(11 * 60 * 1000)
    // #then
    expect((await app.agent.status()).health).toBe('stale')
  })
})

describe('agent tick with no chain access', () => {
  it('logs the failed task sourcing and creates the task once the RPC is back', async () => {
    // #given the chain is down
    const chain = new SwitchableChain()
    const app = await makeApp({ chain })
    chain.down = true
    // #when
    const failing = await app.agent.tick('aeon')
    // #then
    expect(failing.status).toBe('error')
    expect(failing.actions).toEqual([
      expect.objectContaining({ action: 'source_task', result: 'error', error: 'rpc down' }),
    ])
    expect((await app.agent.status()).health).toBe('error')

    // #when the RPC is back
    chain.down = false
    const recovered = await app.agent.tick('aeon')
    // #then
    expect(recovered.openTasks).toEqual(['task_001'])
    expect((await app.agent.status()).health).toBe('alive')
  })
})
