import { describe, expect, it } from 'vitest'
import { ARC_TESTNET_FIXTURES } from '@/server/chain/fixture-reader'
import { loadConfig } from '@/server/config'
import { ArcPaymentRail } from '@/server/payments/arc-rail'
import { PaymentConfigError, PaymentPolicyError, PaymentRailError } from '@/server/payments/payment-provider'
import { FlakyRail, TEST_ENV, WORKER_A, claimAndSubmit, correctAnswer, makeApp, openTask } from './helpers'

describe('payment configuration fails closed', () => {
  it('refuses to start without an explicit PAYMENT_PROVIDER', () => {
    // #given
    const { PAYMENT_PROVIDER: _omit, ...env } = TEST_ENV
    // #when/#then
    expect(() => loadConfig(env)).toThrow(PaymentConfigError)
  })

  it('refuses an unknown provider', () => {
    // #when/#then
    expect(() => loadConfig({ ...TEST_ENV, PAYMENT_PROVIDER: 'stripe' })).toThrow(PaymentConfigError)
  })

  it('refuses the arc provider without a key', () => {
    // #when/#then
    expect(() => loadConfig({ ...TEST_ENV, PAYMENT_PROVIDER: 'arc' })).toThrow(PaymentConfigError)
    expect(() => new ArcPaymentRail({ rpcUrl: 'http://x', explorerUrl: 'http://y', privateKey: '0x1234' })).toThrow(
      PaymentConfigError,
    )
  })

  it('refuses a task reward above the per-task cap', () => {
    // #when/#then
    expect(() => loadConfig({ ...TEST_ENV, TASK_REWARD_USDC: '2', MAX_REWARD_USDC: '1' })).toThrow(PaymentConfigError)
  })
})

describe('spending policy', () => {
  it('caps outstanding escrow across funded tasks', async () => {
    // #given escrow at its cap
    const app = await makeApp({ env: { MAX_OUTSTANDING_ESCROW_USDC: '2' } })
    await openTask(app, ARC_TESTNET_FIXTURES[0]!.hash)
    await openTask(app, ARC_TESTNET_FIXTURES[1]!.hash)
    const third = await app.tasks.createTask(ARC_TESTNET_FIXTURES[2]!.hash, 'test')
    // #when/#then
    await expect(app.tasks.fundTask(third.id, 'test')).rejects.toBeInstanceOf(PaymentPolicyError)
    // #then
    expect((await app.store.requireTask(third.id)).state).toBe('DRAFT')
  })

  it('stops paying once the daily cap is reached', async () => {
    // #given two accepted tasks under a 1 USDC cap
    const app = await makeApp({ env: { DAILY_PAYOUT_CAP_USDC: '1' } })
    const [first, second] = ARC_TESTNET_FIXTURES
    const accept = async (fixture: typeof first) => {
      const task = await openTask(app, fixture!.hash)
      await claimAndSubmit(app, task.id, WORKER_A, correctAnswer(fixture))
      return await app.tasks.verifySubmission(task.id, 'test')
    }
    const paidTask = await accept(first)
    const cappedTask = await accept(second)

    // #when/#then
    expect((await app.tasks.releasePayment(paidTask.id, 'test')).state).toBe('PAID')
    await expect(app.tasks.releasePayment(cappedTask.id, 'test')).rejects.toBeInstanceOf(PaymentPolicyError)
    expect((await app.store.requireTask(cappedTask.id)).state).toBe('ACCEPTED')
  })

  it('only pays the claimant of an ACCEPTED task', async () => {
    // #given an accepted task
    const app = await makeApp()
    const task = await openTask(app)
    await claimAndSubmit(app, task.id, WORKER_A, correctAnswer())
    const accepted = await app.tasks.verifySubmission(task.id, 'test')
    // #when/#then
    await expect(app.payments.releasePayment(accepted, '0x9999999999999999999999999999999999999999')).rejects.toBeInstanceOf(
      PaymentPolicyError,
    )
    await expect(app.payments.releasePayment({ ...accepted, state: 'OPEN' }, WORKER_A)).rejects.toBeInstanceOf(PaymentPolicyError)
  })
})

describe('payout idempotency under failure', () => {
  it('retries a failed broadcast with the same signed transaction', async () => {
    // #given a rail that fails twice
    const rail = new FlakyRail(2)
    const app = await makeApp({ rail })
    const task = await openTask(app)
    await claimAndSubmit(app, task.id, WORKER_A, correctAnswer())
    await app.tasks.verifySubmission(task.id, 'test')

    // #when release is retried
    await expect(app.tasks.releasePayment(task.id, 'test')).rejects.toBeInstanceOf(PaymentRailError)
    const pending = await app.store.getPayment(task.id, 'release')
    expect(pending?.status).toBe('pending')
    await expect(app.tasks.releasePayment(task.id, 'test')).rejects.toBeInstanceOf(PaymentRailError)
    const paid = await app.tasks.releasePayment(task.id, 'test')

    // #then
    expect(paid.state).toBe('PAID')
    expect(rail.signs).toBe(1)
    expect(rail.broadcasts).toBe(3)
    expect((await app.store.getPayment(task.id, 'release'))?.txHash).toBe(pending?.txHash)
    expect((await app.store.listEvents(task.id)).filter((e) => e.type === 'payment_failed')).toHaveLength(2)
  })
})
