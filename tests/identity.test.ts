import { describe, expect, it } from 'vitest'
import type { IdentityVerifier, VerifiedIdentity } from '@/server/identity'
import { WORKER_A, WORKER_B, claimAndSubmit, correctAnswer, makeApp, openTask } from './helpers'

/** Stands in for Privy: the test decides who is signed in. */
const requiredIdentity: IdentityVerifier = { required: true, verify: async () => null }

const person = (userId: string, ...wallets: string[]): VerifiedIdentity => ({ userId, wallets: wallets as `0x${string}`[] })

describe('claims with verified identity', () => {
  it('refuses a claim from someone who is not signed in', async () => {
    // #given an app that requires sign-in
    const app = makeApp({ identity: requiredIdentity })
    const task = await openTask(app)
    // #when/#then
    expect(() => app.tasks.claimTask(task.id, WORKER_A, null)).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }))
  })

  it('refuses a payout wallet the person does not own', async () => {
    // #given a signed-in person who owns only WORKER_A
    const app = makeApp({ identity: requiredIdentity })
    const task = await openTask(app)
    // #when/#then claiming for WORKER_B fails
    expect(() => app.tasks.claimTask(task.id, WORKER_B, person('did:privy:alice', WORKER_A))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    )
  })

  it('lets a person claim with their own linked wallet', async () => {
    // #given
    const app = makeApp({ identity: requiredIdentity })
    const task = await openTask(app)
    // #when
    const claim = app.tasks.claimTask(task.id, WORKER_A, person('did:privy:alice', WORKER_A))
    // #then
    expect(claim.task).toMatchObject({ state: 'CLAIMED', claimant: WORKER_A })
  })

  it('gives each person one answer per task even across their wallets', async () => {
    // #given alice answered wrong with one wallet and the task reopened
    const app = makeApp({ identity: requiredIdentity })
    const task = await openTask(app)
    const alice = person('did:privy:alice', WORKER_A, WORKER_B)
    const claim = app.tasks.claimTask(task.id, WORKER_A, alice)
    app.tasks.submitTask(task.id, { claimId: claim.claimId, claimToken: claim.claimToken, recipient: WORKER_A, amount: '1' })
    await app.tasks.verifySubmission(task.id, 'test')
    app.tasks.reopenTask(task.id, 'test')
    // #when/#then her second wallet cannot try again
    expect(() => app.tasks.claimTask(task.id, WORKER_B, alice)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('stays open for anyone when identity is not configured', async () => {
    // #given the default open verifier
    const app = makeApp()
    const task = await openTask(app)
    // #when
    await claimAndSubmit(app, task.id, WORKER_A, correctAnswer())
    // #then
    expect(app.store.requireTask(task.id).state).toBe('SUBMITTED')
  })
})
