import { describe, expect, it } from 'vitest'
import { TASK_STATES, assertTransition, canTransition, IllegalTransitionError, isTerminal } from '@/domain/task-state'
import { StaleStateError } from '@/server/store/store'
import { makeApp, openTask } from './helpers'

describe('task state machine', () => {
  it('allows the documented happy path', () => {
    // #given
    const path = ['DRAFT', 'FUNDED', 'OPEN', 'CLAIMED', 'SUBMITTED', 'VERIFYING', 'ACCEPTED', 'PAID'] as const
    // #when/#then
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true)
    }
  })

  it('allows rejection, reopen, expiry and refund edges', () => {
    // #when/#then
    expect(canTransition('VERIFYING', 'REJECTED')).toBe(true)
    expect(canTransition('REJECTED', 'OPEN')).toBe(true)
    expect(canTransition('OPEN', 'EXPIRED')).toBe(true)
    expect(canTransition('EXPIRED', 'REFUNDED')).toBe(true)
  })

  it.each([
    ['OPEN', 'PAID'],
    ['DRAFT', 'OPEN'],
    ['CLAIMED', 'PAID'],
    ['SUBMITTED', 'ACCEPTED'],
    ['EXPIRED', 'PAID'],
    ['PAID', 'REFUNDED'],
    ['REFUNDED', 'OPEN'],
    ['ACCEPTED', 'REFUNDED'],
  ] as const)('rejects %s -> %s', (from, to) => {
    // #when/#then
    expect(canTransition(from, to)).toBe(false)
    expect(() => assertTransition('task_x', from, to)).toThrow(IllegalTransitionError)
  })

  it('makes PAID and REFUNDED terminal with no outgoing edges', () => {
    // #when/#then
    for (const to of TASK_STATES) {
      expect(canTransition('PAID', to)).toBe(false)
      expect(canTransition('REFUNDED', to)).toBe(false)
    }
    expect(isTerminal('PAID')).toBe(true)
    expect(isTerminal('REFUNDED')).toBe(true)
    expect(isTerminal('OPEN')).toBe(false)
  })

  it('store refuses an illegal transition and leaves the task untouched', async () => {
    // #given an open task
    const app = await makeApp()
    const task = await openTask(app)
    // #when/#then
    await expect(
      app.store.transition({ taskId: task.id, from: 'OPEN', to: 'PAID', at: app.clock.now(), actor: 'test', event: 'paid' }),
    ).rejects.toThrow(IllegalTransitionError)
    // #then
    expect((await app.store.requireTask(task.id)).state).toBe('OPEN')
  })

  it('store refuses a transition from a state the task is not in', async () => {
    // #given an open task
    const app = await makeApp()
    const task = await openTask(app)
    // #when/#then
    await expect(
      app.store.transition({ taskId: task.id, from: 'CLAIMED', to: 'SUBMITTED', at: app.clock.now(), actor: 'test', event: 'submitted' }),
    ).rejects.toThrow(StaleStateError)
  })

  it('records every transition as an append-only event', async () => {
    // #when a task is opened
    const app = await makeApp()
    const task = await openTask(app)
    // #then
    const events = await app.store.listEvents(task.id)
    expect(events.map((e) => e.type)).toEqual(['created', 'funded', 'published'])
    expect(events[2]).toMatchObject({ fromState: 'FUNDED', toState: 'OPEN' })
  })
})
