import { describe, expect, it } from 'vitest'
import type { CiTaskView, TaskView } from '@/domain/views'
import { rankOpenWork } from '@/server/queries'

const ci = (bonusUsdc: string | null): CiTaskView => ({
  findingId: 'find_1',
  findingDisplayId: 'FIND-001',
  repo: 'o/r',
  repoUrl: 'https://github.com/o/r',
  baseBranch: 'main',
  workflowName: 'CI',
  workflowPath: '.github/workflows/ci.yml',
  jobName: 'test',
  acceptance: 'passes',
  scope: 'fix it',
  protectedPaths: [],
  requireMerge: true,
  contributors: [],
  openToAnyone: true,
  bonusUsdc,
  approvedBy: 'owner',
})

function task(id: string, patch: Partial<TaskView> & { bonus?: string | null } = {}): TaskView {
  const { bonus = null, ...rest } = patch
  return {
    id,
    displayId: id.toUpperCase(),
    kind: 'ci-fix',
    title: id,
    description: '',
    reward: '1.00',
    currency: 'USDC',
    chain: 'arc-testnet',
    state: 'OPEN',
    deadlineAt: 10_000,
    createdAt: 0,
    claimedAt: null,
    submittedAt: null,
    settledAt: null,
    claimant: null,
    claimantHandle: null,
    claimExpiresAt: null,
    attemptCount: 0,
    tx: null,
    ci: ci(bonus),
    ...rest,
  }
}

describe('ranking open work', () => {
  it('puts claimable work first, the biggest total payout first, then the soonest deadline', () => {
    // #given work in mixed states, rewards, bonuses and deadlines
    const ranked = rankOpenWork([
      task('claimed-big', { state: 'CLAIMED', reward: '1.00', bonus: '99.00' }),
      task('small-soon', { reward: '0.25', deadlineAt: 1_000 }),
      task('bonus-late', { reward: '1.00', bonus: '29.00', deadlineAt: 9_000 }),
      task('bonus-soon', { reward: '1.00', bonus: '29.00', deadlineAt: 2_000 }),
      task('plain', { reward: '1.00' }),
    ])

    // #then a human sees what they can take now, best paid first
    expect(ranked.map((t) => t.id)).toEqual(['bonus-soon', 'bonus-late', 'plain', 'small-soon', 'claimed-big'])
  })
})
