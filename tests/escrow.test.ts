import { describe, expect, it } from 'vitest'
import type { Hex } from '@/domain/types'
import { MockPaymentRail } from '@/server/payments/mock-rail'
import { PaymentRailError, type RailCall } from '@/server/payments/payment-provider'
import { WORKER_A, claimAndSubmit, correctAnswer, makeApp } from './helpers'

const HOUR = 60 * 60 * 1000

/** Behaves like ArcEscrowRail: every money movement is a transaction that may confirm late. */
class FakeEscrowRail extends MockPaymentRail {
  override readonly onchainEscrow = true
  pendingConfirmations = 0
  chainBehind = false
  readonly signed: RailCall['kind'][] = []

  async beforeSign(call: RailCall): Promise<void> {
    if (call.kind === 'refund' && this.chainBehind) throw new PaymentRailError('chain clock behind deadline')
  }

  override async sign(call: RailCall) {
    this.signed.push(call.kind)
    return super.sign(call)
  }

  override async confirmation(_txHash: Hex): Promise<'confirmed'> {
    if (this.pendingConfirmations > 0) {
      this.pendingConfirmations--
      return 'pending' as 'confirmed'
    }
    return 'confirmed'
  }
}

describe('escrow rail', () => {
  it('keeps a task unpublished until its funding transaction confirms', async () => {
    // #given funding that confirms one tick late
    const rail = new FakeEscrowRail()
    rail.pendingConfirmations = 1
    const app = await makeApp({ rail })
    // #when the agent ticks twice
    const first = await app.agent.tick('aeon')
    const second = await app.agent.tick('aeon')
    // #then the first tick waits and the second publishes, signing funding exactly once
    expect(first.actions.find((a) => a.action === 'fund')?.result).toBe('skipped')
    expect((await app.store.requireTask('task_001')).state).toBe('OPEN')
    expect(second.actions.map((a) => a.action)).toContain('publish')
    expect(rail.signed.filter((k) => k === 'fund')).toHaveLength(1)
  })

  it('moves fund, release and refund each as one on-chain transaction', async () => {
    // #given one paid task and one expired task
    const rail = new FakeEscrowRail()
    const app = await makeApp({ rail, env: { TARGET_OPEN_TASKS: '2' } })
    await app.agent.tick('aeon')
    await claimAndSubmit(app, 'task_001', WORKER_A, correctAnswer())
    await app.agent.onSubmission('task_001')
    app.clock.advance(6 * HOUR)
    // #when the agent sweeps
    await app.agent.tick('aeon')
    // #then every payment row carries a transaction hash
    expect((await app.store.requireTask('task_001')).state).toBe('PAID')
    expect((await app.store.requireTask('task_002')).state).toBe('REFUNDED')
    for (const p of [...await app.store.listPayments('task_001'), ...await app.store.listPayments('task_002')]) {
      expect(p.txHash).toMatch(/^0x[0-9a-f]{64}$/)
    }
    expect(rail.signed.filter((k) => k === 'release')).toHaveLength(1)
    expect(rail.signed.filter((k) => k === 'refund')).toHaveLength(1)
  })

  it('retries a refund until the chain clock passes the deadline', async () => {
    // #given an expired task while the chain lags behind
    const rail = new FakeEscrowRail()
    const app = await makeApp({ rail })
    await app.agent.tick('aeon')
    app.clock.advance(6 * HOUR)
    rail.chainBehind = true
    // #when the agent ticks, then the chain catches up and it ticks again
    const lagging = await app.agent.tick('aeon')
    rail.chainBehind = false
    await app.agent.tick('aeon')
    // #then the first attempt is a retryable error and the second settles
    expect(lagging.actions.find((a) => a.taskId === 'task_001' && a.result === 'error')).toBeDefined()
    expect((await app.store.requireTask('task_001')).state).toBe('REFUNDED')
    expect(rail.signed.filter((k) => k === 'refund')).toHaveLength(1)
  })
})
