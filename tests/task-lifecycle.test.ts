import { describe, expect, it } from 'vitest'
import { formatUsdc } from '@/domain/money'
import { DomainError } from '@/server/errors'
import { FIXTURE, FIXTURE_2, WORKER_A, WORKER_B, claimAndSubmit, correctAnswer, makeApp, openTask } from './helpers'

const HOUR = 60 * 60 * 1000

function expectDomainError(fn: () => unknown, code: DomainError['code']) {
  expect(fn).toThrow(expect.objectContaining({ name: 'DomainError', code }))
}

describe('task creation', () => {
  it('snapshots the on-chain answer and starts as DRAFT', async () => {
    const app = makeApp()
    const task = await app.tasks.createTask(FIXTURE.hash, 'test')
    expect(task).toMatchObject({ id: 'task_001', state: 'DRAFT', rewardMicro: 1_000_000n, txHash: FIXTURE.hash })
    expect(task.expected.recipient).toBe(FIXTURE.recipient)
    expect(task.expected.amountMicro).toBe(FIXTURE.amountMicro)
    expect(task.deadlineAt - task.createdAt).toBe(6 * HOUR)
  })

  it('funds then publishes', async () => {
    const app = makeApp()
    const task = await openTask(app)
    expect(task.state).toBe('OPEN')
    expect(app.store.getPayment(task.id, 'fund')?.status).toBe('confirmed')
  })

  it('refuses a second task for the same transaction', async () => {
    const app = makeApp()
    await openTask(app)
    await expect(app.tasks.createTask(FIXTURE.hash, 'test')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('refuses a transaction the chain does not know', async () => {
    const app = makeApp()
    await expect(app.tasks.createTask(`0x${'ab'.repeat(32)}`, 'test')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('claiming', () => {
  it('gives the first worker a short claim lock', async () => {
    const app = makeApp()
    const task = await openTask(app)
    const claim = app.tasks.claimTask(task.id, WORKER_A)
    expect(claim.task.state).toBe('CLAIMED')
    expect(claim.task.claimant).toBe(WORKER_A)
    expect(claim.claimExpiresAt - app.clock.now()).toBe(10 * 60 * 1000)
    expect(claim.claimToken).toMatch(/^[0-9a-f]{48}$/)
  })

  it('prevents a second claim while the lock is held', async () => {
    const app = makeApp()
    const task = await openTask(app)
    app.tasks.claimTask(task.id, WORKER_A)
    expectDomainError(() => app.tasks.claimTask(task.id, WORKER_B), 'CONFLICT')
    expect(app.store.requireTask(task.id).claimant).toBe(WORKER_A)
  })

  it('lets another worker claim once the lock lapses', async () => {
    const app = makeApp()
    const task = await openTask(app)
    app.tasks.claimTask(task.id, WORKER_A)
    app.clock.advance(11 * 60 * 1000)
    const claim = app.tasks.claimTask(task.id, WORKER_B)
    expect(claim.task.claimant).toBe(WORKER_B)
    expect(app.store.listAttempts(task.id)[0]?.outcome).toBe('LAPSED')
  })

  it('rejects an invalid wallet', async () => {
    const app = makeApp()
    const task = await openTask(app)
    expectDomainError(() => app.tasks.claimTask(task.id, 'not-a-wallet'), 'BAD_REQUEST')
  })
})

describe('submission', () => {
  it('moves the task to SUBMITTED and stores the answer', async () => {
    const app = makeApp()
    const task = await openTask(app)
    await claimAndSubmit(app, task.id, WORKER_A, correctAnswer())
    expect(app.store.requireTask(task.id).state).toBe('SUBMITTED')
    expect(app.store.listAttempts(task.id)[0]?.submission).toEqual(correctAnswer())
  })

  it('requires the claim token', async () => {
    const app = makeApp()
    const task = await openTask(app)
    const claim = app.tasks.claimTask(task.id, WORKER_A)
    expectDomainError(
      () => app.tasks.submitTask(task.id, { claimId: claim.claimId, claimToken: 'f'.repeat(48), ...correctAnswer() }),
      'FORBIDDEN',
    )
  })

  it('cannot replay a submission on the same claim', async () => {
    const app = makeApp()
    const task = await openTask(app)
    const claim = await claimAndSubmit(app, task.id, WORKER_A, correctAnswer())
    expectDomainError(
      () => app.tasks.submitTask(task.id, { claimId: claim.claimId, claimToken: claim.claimToken, ...correctAnswer() }),
      'CONFLICT',
    )
  })

  it('rejects malformed answers without consuming the claim', async () => {
    const app = makeApp()
    const task = await openTask(app)
    const claim = app.tasks.claimTask(task.id, WORKER_A)
    expectDomainError(
      () => app.tasks.submitTask(task.id, { claimId: claim.claimId, claimToken: claim.claimToken, recipient: 'bob', amount: '1' }),
      'BAD_REQUEST',
    )
    expect(app.store.requireTask(task.id).state).toBe('CLAIMED')
  })

  it('refuses a submission after the claim lock lapsed', async () => {
    const app = makeApp()
    const task = await openTask(app)
    const claim = app.tasks.claimTask(task.id, WORKER_A)
    app.clock.advance(11 * 60 * 1000)
    expectDomainError(
      () => app.tasks.submitTask(task.id, { claimId: claim.claimId, claimToken: claim.claimToken, ...correctAnswer() }),
      'GONE',
    )
  })
})

describe('verification and payment', () => {
  it('accepts a correct answer and pays the claimant', async () => {
    const app = makeApp()
    const task = await openTask(app)
    await claimAndSubmit(app, task.id, WORKER_A, correctAnswer())
    expect((await app.tasks.verifySubmission(task.id, 'test')).state).toBe('ACCEPTED')
    const paid = await app.tasks.releasePayment(task.id, 'test')
    expect(paid.state).toBe('PAID')
    const payout = app.store.getPayment(task.id, 'release')
    expect(payout).toMatchObject({ status: 'confirmed', recipient: WORKER_A, amountMicro: 1_000_000n })
    expect(payout?.txHash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('rejects a wrong answer and records why', async () => {
    const app = makeApp()
    const task = await openTask(app)
    await claimAndSubmit(app, task.id, WORKER_A, { recipient: FIXTURE.recipient, amount: '9.99' })
    const rejected = await app.tasks.verifySubmission(task.id, 'test')
    expect(rejected.state).toBe('REJECTED')
    const attempt = app.store.listAttempts(task.id)[0]
    expect(attempt?.outcome).toBe('FAIL')
    expect(attempt?.verification?.reason).toBe('Amount does not match the on-chain transfer.')
    await expect(app.tasks.releasePayment(task.id, 'test')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('reopens a rejected task for other workers but not for the same wallet', async () => {
    const app = makeApp()
    const task = await openTask(app)
    await claimAndSubmit(app, task.id, WORKER_A, { recipient: FIXTURE.from, amount: '1' })
    await app.tasks.verifySubmission(task.id, 'test')
    expect(app.tasks.reopenTask(task.id, 'test').state).toBe('OPEN')
    expectDomainError(() => app.tasks.claimTask(task.id, WORKER_A), 'FORBIDDEN')
    expect(app.tasks.claimTask(task.id, WORKER_B).task.claimant).toBe(WORKER_B)
  })

  it('pays exactly once no matter how often release is called', async () => {
    const app = makeApp()
    const task = await openTask(app)
    await claimAndSubmit(app, task.id, WORKER_A, correctAnswer())
    await app.tasks.verifySubmission(task.id, 'test')
    const first = await app.tasks.releasePayment(task.id, 'test')
    const second = await app.tasks.releasePayment(task.id, 'test')
    expect(first.state).toBe('PAID')
    expect(second.state).toBe('PAID')
    expect(app.store.listPayments(task.id).filter((p) => p.kind === 'release')).toHaveLength(1)
    expect(app.store.listEvents(task.id).filter((e) => e.type === 'paid')).toHaveLength(1)
  })

  it('pays a submission made before the deadline even if verified after it', async () => {
    const app = makeApp()
    const task = await openTask(app)
    app.clock.advance(6 * HOUR - 60_000)
    await claimAndSubmit(app, task.id, WORKER_A, correctAnswer())
    app.clock.advance(5 * 60_000)
    await app.tasks.verifySubmission(task.id, 'test')
    expect((await app.tasks.releasePayment(task.id, 'test')).state).toBe('PAID')
  })
})

describe('expiry and refund', () => {
  it('expires an unclaimed task at its deadline and refunds it', async () => {
    const app = makeApp()
    const task = await openTask(app)
    expectDomainError(() => app.tasks.expireTask(task.id, 'test'), 'CONFLICT')
    app.clock.advance(6 * HOUR)
    expect(app.tasks.expireTask(task.id, 'test').state).toBe('EXPIRED')
    const refunded = await app.tasks.refundTask(task.id, 'test')
    expect(refunded.state).toBe('REFUNDED')
    expect(app.store.getPayment(task.id, 'refund')).toMatchObject({ status: 'confirmed', amountMicro: 1_000_000n })
    expectDomainError(() => app.tasks.claimTask(task.id, WORKER_A), 'CONFLICT')
  })

  it('refund is idempotent and a refunded task can never be paid', async () => {
    const app = makeApp()
    const task = await openTask(app)
    app.clock.advance(6 * HOUR)
    app.tasks.expireTask(task.id, 'test')
    await app.tasks.refundTask(task.id, 'test')
    await app.tasks.refundTask(task.id, 'test')
    expect(app.store.listPayments(task.id).filter((p) => p.kind === 'refund')).toHaveLength(1)
    await expect(app.tasks.releasePayment(task.id, 'test')).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('receipts', () => {
  it('writes a frozen receipt with expected, submitted, payout and timeline', async () => {
    const app = makeApp()
    const task = await openTask(app, FIXTURE_2.hash)
    await claimAndSubmit(app, task.id, WORKER_A, correctAnswer(FIXTURE_2))
    await app.tasks.verifySubmission(task.id, 'test')
    await app.tasks.releasePayment(task.id, 'test')

    const receipt = app.tasks.getReceipt(task.id)
    expect(receipt.final).toBe(true)
    expect(receipt.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(receipt.outcome).toBe('PAID')
    expect(receipt.worker).toBe(WORKER_A)
    expect(receipt.task.expected).toEqual({ recipient: FIXTURE_2.recipient, amount: formatUsdc(FIXTURE_2.amountMicro) })
    expect(receipt.attempts[0]?.verification?.code).toBe('MATCH')
    expect(receipt.payout).toMatchObject({ kind: 'release', amount: '1.00', recipient: WORKER_A, simulated: true })
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
  })

  it('cannot be modified or deleted once written', async () => {
    const app = makeApp()
    const task = await openTask(app)
    app.clock.advance(6 * HOUR)
    app.tasks.expireTask(task.id, 'test')
    await app.tasks.refundTask(task.id, 'test')
    const db = (app.store as unknown as { db: { exec(sql: string): void } }).db
    expect(() => db.exec(`UPDATE receipts SET outcome = 'PAID' WHERE task_id = '${task.id}'`)).toThrow(/immutable/)
    expect(() => db.exec(`DELETE FROM receipts`)).toThrow(/immutable/)
    expect(() => db.exec(`DELETE FROM task_events`)).toThrow(/append-only/)
    expect(app.tasks.getReceipt(task.id).outcome).toBe('REFUNDED')
  })

  it('withholds the expected answer while the task is still open', async () => {
    const app = makeApp()
    const task = await openTask(app)
    await claimAndSubmit(app, task.id, WORKER_A, { recipient: FIXTURE.recipient, amount: '0.5' })
    await app.tasks.verifySubmission(task.id, 'test')
    const receipt = app.tasks.getReceipt(task.id)
    expect(receipt.final).toBe(false)
    expect(receipt.task.expected).toBeNull()
    expect(receipt.attempts[0]?.verification?.expected).toBeNull()
    expect(receipt.attempts[0]?.verification?.fields.every((f) => f.expected === null)).toBe(true)
    expect(JSON.stringify(receipt)).not.toContain(formatUsdc(FIXTURE.amountMicro))
  })
})
