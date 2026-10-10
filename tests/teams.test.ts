import { describe, expect, it, vi } from 'vitest'
import type { Address } from '@/domain/types'
import { canFund, canSeeRepo, resolveViewer, type Viewer } from '@/server/access'
import { roleFromPermissions } from '@/server/github/oauth'
import { accessRequestMessage, notifyOperator } from '@/server/notify'
import type { ExternalizeInput } from '@/server/services/work-service'
import { FakeGitHub, NAME, OWNER, sha } from './fake-github'
import { OPERATOR, T0, makeApp } from './helpers'

const HOUR = 60 * 60 * 1000
const REPO = `${OWNER}/${NAME}`
const ADA_WALLET: Address = '0x3333333333333333333333333333333333333333'

const member = (team: string, role: 'admin' | 'engineer'): Viewer => ({
  actor: `github:${role}-of-${team}`,
  operator: false,
  teams: new Map([[team, role]]),
  repos: new Map([[`${team}/${team === OWNER ? NAME : 'app'}`.toLowerCase(), role]]),
})
const ACME_ADMIN = member(OWNER, 'admin')
const ACME_ENGINEER = member(OWNER, 'engineer')
const STRANGER = member('othercorp', 'admin')

function input(reward = '0.75'): ExternalizeInput {
  return {
    reward,
    deadlineHours: 24,
    contributors: [{ login: 'ada', wallet: ADA_WALLET }],
    acceptance: 'The examples job passes on main.',
    scope: 'Fix src/transfer.ts.',
    protectedPaths: [],
    requireMerge: true,
  }
}

/** acme/sdk-examples watched, with a candidate finding, and a team row for acme. */
async function acme() {
  const github = new FakeGitHub()
  const app = await makeApp({ github, env: { TARGET_OPEN_TASKS: '0' } })
  github.addRun({ sha: sha('a1'), at: T0 - 4 * HOUR, conclusion: 'success' })
  github.addRun({ sha: sha('b1'), at: T0 - 3 * HOUR, conclusion: 'failure' })
  github.addRun({ sha: sha('c1'), at: T0 - 2 * HOUR, conclusion: 'failure' })
  await app.teams.recordSignIn('admin-of-acme', [{ team: OWNER, installationId: 1, role: 'admin', repos: { [`${OWNER}/${NAME}`.toLowerCase()]: 'admin' } }], T0)
  await app.work.connectRepo(REPO, undefined, ACME_ADMIN)
  const finding = (await app.watch.listFindings())[0]!
  return { app, github, finding }
}

describe('who can see and fund what', () => {
  it('lets operators see everything and members only the repos GitHub lets them reach', () => {
    expect(canSeeRepo(OPERATOR, 'anyone', 'anything')).toBe(true)
    expect(canSeeRepo(ACME_ENGINEER, 'ACME', NAME)).toBe(true)
    expect(canSeeRepo(STRANGER, OWNER, NAME)).toBe(false)
  })

  it('keeps a member out of their own team\'s repos they cannot reach on GitHub', () => {
    // #given an engineer who can reach acme/sdk-examples but not acme/payroll
    expect(canSeeRepo(ACME_ENGINEER, OWNER, 'payroll')).toBe(false)
  })

  it('lets only operators and admins of that very repo put money behind work', () => {
    expect(canFund(OPERATOR, OWNER, NAME)).toBe(true)
    expect(canFund(ACME_ADMIN, OWNER, NAME)).toBe(true)
    expect(canFund(ACME_ENGINEER, OWNER, NAME)).toBe(false)
    // an admin of one small repo cannot spend on another repo of the team
    expect(canFund(ACME_ADMIN, OWNER, 'payroll')).toBe(false)
  })

  it.each([
    [{ admin: true, push: true }, 'admin'],
    [{ maintain: true }, 'engineer'],
    [{ push: true }, 'engineer'],
    [{ pull: true }, null],
    [undefined, null],
  ])('maps GitHub permissions %o to %s', (permissions, role) => {
    expect(roleFromPermissions(permissions)).toBe(role)
  })
})

describe('a team cannot reach another team', () => {
  it('cannot watch a repository of another account', async () => {
    const { app } = await acme()
    await expect(app.work.connectRepo(REPO, undefined, STRANGER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('cannot see, keep, dismiss or fund another team\'s finding, and is told it does not exist', async () => {
    const { app, finding } = await acme()
    await expect(app.work.keepInternal(finding.id, STRANGER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(app.work.dismiss(finding.id, STRANGER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(app.work.externalize(finding.id, input(), STRANGER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('cannot release a claim on another team\'s work', async () => {
    const { app, finding } = await acme()
    const task = await app.work.externalize(finding.id, input(), OPERATOR)
    await expect(app.work.releaseClaim(task.id, STRANGER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('lets a team engineer decide, but not spend', async () => {
    // #given an engineer of acme
    const { app, finding } = await acme()
    // #when/#then
    await expect(app.work.externalize(finding.id, input(), ACME_ENGINEER)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await app.work.keepInternal(finding.id, ACME_ENGINEER)).status).toBe('internal')
  })
})

describe('team access follows GitHub', () => {
  it('stops trusting a membership 12 hours after GitHub last confirmed it', async () => {
    // #given an engineer confirmed by GitHub at sign-in
    const { app } = await acme()
    await app.teams.recordSignIn('dev', [{ team: OWNER, installationId: 1, role: 'engineer', repos: { [`${OWNER}/${NAME}`.toLowerCase()]: 'engineer' } }], T0)
    const auth = { githubLogins: [] as string[], sessionSecret: 's' }
    // #then trusted for 12 hours, then they must sign in again
    expect(await resolveViewer('github:dev', auth, app.teams, T0 + 11 * 60 * 60 * 1000)).not.toBeNull()
    expect(await resolveViewer('github:dev', auth, app.teams, T0 + 13 * 60 * 60 * 1000)).toBeNull()
  })
})

describe('a team spends only its budget', () => {
  it('starts at zero, so joining a team never spends the operator wallet', async () => {
    const { app, finding } = await acme()
    await expect(app.work.externalize(finding.id, input(), ACME_ADMIN)).rejects.toThrow(/no funds for paid work yet/)
  })

  it('funds work within the budget the operator set, and refuses past it', async () => {
    // #given the operator sponsors acme with 1 USDC
    const { app, github, finding } = await acme()
    await app.teams.setBudget(OWNER, 1_000_000n, T0)
    // #when acme's admin posts 0.75 USDC of work
    const task = await app.work.externalize(finding.id, input('0.75'), ACME_ADMIN)
    expect(task.state).toBe('OPEN')
    // #and a second failure becomes another finding
    github.addRun({ sha: sha('d1'), at: T0 - HOUR, conclusion: 'failure', failing: { job: 'lint', step: 'Run lint' } })
    github.addRun({ sha: sha('e1'), at: T0 - HOUR / 2, conclusion: 'failure', failing: { job: 'lint', step: 'Run lint' } })
    await app.work.observe(await app.watch.requireRepo(REPO.toLowerCase()))
    const second = (await app.watch.listFindings({ statuses: ['candidate'] }))[0]!
    // #then 0.75 more would pass 1 USDC
    await expect(app.work.externalize(second.id, input('0.75'), ACME_ADMIN)).rejects.toThrow(/0.25 USDC available \(0.75 set aside for open work/)
  })

  it('does not limit operators', async () => {
    const { app, finding } = await acme()
    expect((await app.work.externalize(finding.id, input(), OPERATOR)).state).toBe('OPEN')
  })
})

describe('telling the operator about access requests', () => {
  it('counts attempts per person and people overall', async () => {
    const { app } = await acme()
    await app.teams.recordAccessRequest('Eve', T0)
    const again = await app.teams.recordAccessRequest('eve', T0 + 1)
    const other = await app.teams.recordAccessRequest('frank', T0 + 2)
    expect(again).toMatchObject({ firstTime: false, people: 1, request: { attempts: 2 } })
    expect(other).toMatchObject({ firstTime: true, people: 2 })
  })

  it('carries each new attempt in the next sweep, once, for the operator\'s own channel', async () => {
    // #given eve asked twice and frank once
    const { app } = await acme()
    await app.teams.recordAccessRequest('eve', T0)
    await app.teams.recordAccessRequest('eve', T0 + 1)
    await app.teams.recordAccessRequest('frank', T0 + 2)
    // #when the agent sweeps twice
    const first = await app.agent.tick('aeon')
    const second = await app.agent.tick('aeon')
    // #then the first sweep tells the operator about both, the second about nobody
    expect(first.operatorNotices).toEqual([
      expect.stringMatching(/^@eve tried to sign in.*\(tried 2 times\)/),
      expect.stringContaining('@frank tried to sign in'),
    ])
    expect(second.operatorNotices).toEqual([])
    // #and a new attempt is told again
    await app.teams.recordAccessRequest('eve', T0 + 3)
    expect((await app.agent.tick('aeon')).operatorNotices).toEqual([expect.stringContaining('@eve tried to sign in to the bon travail console but is not on a team yet (tried 3 times)')])
  })

  it('writes a plain message with the running count', () => {
    expect(accessRequestMessage('eve', 1, 3)).toBe(
      '@eve tried to sign in to the bon travail console but is not on a team yet (first time).\n3 people have asked for access so far.\nhttps://github.com/eve',
    )
  })

  it('posts to Telegram only when a bot is configured, and never throws', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    expect(await notifyOperator({ telegramBotToken: undefined, telegramChatId: undefined }, 'hi', fetchMock)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await notifyOperator({ telegramBotToken: 'tok', telegramChatId: '42' }, 'hi', fetchMock)).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('https://api.telegram.org/bottok/sendMessage', expect.objectContaining({ method: 'POST' }))
    const failing = vi.fn<typeof fetch>(async () => {
      throw new Error('offline')
    })
    expect(await notifyOperator({ telegramBotToken: 'tok', telegramChatId: '42' }, 'hi', failing)).toBe(false)
  })
})
