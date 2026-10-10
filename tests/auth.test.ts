import { beforeAll, describe, expect, it } from 'vitest'
import { resolveViewer } from '@/server/access'
import { OWNER_SESSION_MS, issueOwnerSession, requireSession, verifyOwnerSession, type OwnerAuth } from '@/server/owner'
import { TEST_ENV } from './helpers'

const OWNER_TOKEN = TEST_ENV.OWNER_ACCESS_TOKEN
const SECRET = 'session-secret-session-secret-0000'
const NOW = Date.parse('2026-10-03T12:00:00Z')
const AUTH: OwnerAuth = { accessToken: OWNER_TOKEN, sessionSecret: SECRET, githubLogins: ['octocat'] }

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
type Plain = (request: Request) => Promise<Response>

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const request = (method: string, headers: Record<string, string> = {}, body?: unknown) =>
  new Request('http://console.test/api/x', {
    method,
    headers: { host: 'console.test', 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const cookie = (value: string) => ({ cookie: `pw_owner=${value}` })

let routes: {
  externalize: Handler
  investigation: Handler
  findings: Plain
  workClaim: Handler
  cron: Plain
}

beforeAll(async () => {
  // These routes are checked with GitHub unconfigured; CI runners (GitHub Actions) set GITHUB_TOKEN on their own.
  for (const key of ['GITHUB_TOKEN', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET']) {
    delete process.env[key]
  }
  Object.assign(process.env, TEST_ENV)
  routes = {
    externalize: (await import('@/app/api/owner/findings/[id]/externalize/route')).POST,
    investigation: (await import('@/app/api/agent/findings/[id]/investigation/route')).POST,
    findings: (await import('@/app/api/agent/findings/route')).GET,
    workClaim: (await import('@/app/api/work/[id]/claim/route')).POST,
    cron: (await import('@/app/api/cron/tick/route')).GET,
  }
})

describe('owner sessions', () => {
  it('carries who signed in, and rejects a tampered, expired or rotated session', () => {
    // #given a session issued now for a GitHub login
    const session = issueOwnerSession(SECRET, NOW, 'github:octocat')
    // #when/#then
    expect(verifyOwnerSession(SECRET, session, NOW + 1000)).toBe('github:octocat')
    expect(verifyOwnerSession(SECRET, `${session.slice(0, -1)}${session.endsWith('0') ? '1' : '0'}`, NOW)).toBeNull()
    expect(verifyOwnerSession(SECRET, session.replace(Buffer.from('github:octocat').toString('base64url'), Buffer.from('github:mallory').toString('base64url')), NOW)).toBeNull()
    expect(verifyOwnerSession(SECRET, session, NOW + OWNER_SESSION_MS + 1)).toBeNull()
    expect(verifyOwnerSession(`${SECRET}-rotated`, session, NOW)).toBeNull()
    expect(verifyOwnerSession(SECRET, undefined, NOW)).toBeNull()
  })

  it('fails closed when the console is not configured', () => {
    // #given no token, no session secret, no logins
    // #when/#then
    expect(() => requireSession(request('POST'), { githubLogins: [] }, NOW)).toThrow(expect.objectContaining({ code: 'UNAVAILABLE' }))
  })

  it('accepts the bearer token for scripts and rejects a wrong one', () => {
    // #given bearer headers
    // #when/#then
    expect(requireSession(request('POST', { authorization: `Bearer ${OWNER_TOKEN}` }), AUTH, NOW)).toBe('owner')
    expect(() => requireSession(request('POST', { authorization: 'Bearer nope' }), AUTH, NOW)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    )
  })

  it('revokes an operator the moment their login leaves the list', async () => {
    // #given a valid session for octocat, who is on no team
    const session = issueOwnerSession(SECRET, NOW, 'github:octocat')
    const actor = requireSession(request('POST', { ...cookie(session), origin: 'http://console.test' }), AUTH, NOW)
    const noTeams = { membershipsOf: async () => ({ teams: new Map(), repos: new Map() }) }
    // #when/#then an operator while listed, nobody once removed
    expect(await resolveViewer(actor, AUTH, noTeams, NOW)).toMatchObject({ actor: 'github:octocat', operator: true })
    expect(await resolveViewer(actor, { ...AUTH, githubLogins: ['someone-else'] }, noTeams, NOW)).toBeNull()
  })

  it('lets a team member in, limited to the teams GitHub reported', async () => {
    // #given a login that is not an operator but is an engineer on one team
    const teams = { membershipsOf: async () => ({ teams: new Map([['youdotcom', 'engineer' as const]]), repos: new Map([['youdotcom/sdk', 'engineer' as const]]) }) }
    // #when
    const viewer = await resolveViewer('github:sparker', AUTH, teams, NOW)
    // #then
    expect(viewer).toMatchObject({ operator: false })
    expect([...viewer!.teams]).toEqual([['youdotcom', 'engineer']])
  })

  it('only accepts a cookie-authenticated write from the site itself', () => {
    // #given a valid session cookie
    const session = issueOwnerSession(SECRET, NOW, 'github:octocat')
    // #when/#then same origin passes, cross origin and missing origin do not, reads need no origin
    expect(requireSession(request('POST', { ...cookie(session), origin: 'http://console.test' }), AUTH, NOW)).toBe('github:octocat')
    expect(() => requireSession(request('POST', { ...cookie(session), origin: 'https://evil.test' }), AUTH, NOW)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    )
    expect(() => requireSession(request('POST', cookie(session)), AUTH, NOW)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    expect(() => requireSession(request('POST', { ...cookie(session), origin: 'null' }), AUTH, NOW)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    )
    expect(requireSession(request('GET', cookie(session)), AUTH, NOW)).toBe('github:octocat')
  })
})

describe('HTTP boundaries', () => {
  it('refuses to externalize without the engineer', async () => {
    // #given no session
    // #when
    const res = await routes.externalize(request('POST', { origin: 'http://console.test' }, { reward: '1' }), ctx('find_001'))
    // #then
    expect(res.status).toBe(401)
  })

  it('keeps Aeon endpoints behind the agent token', async () => {
    // #given no token, then the token for a finding that does not exist
    // #when
    const anonymous = await routes.investigation(request('POST', {}, {}), ctx('find_001'))
    const list = await routes.findings(request('GET'))
    const unknown = await routes.investigation(
      request('POST', { authorization: `Bearer ${TEST_ENV.AGENT_API_TOKEN}` }, {
        summary: 's',
        rootCause: 'r',
        proposedAcceptance: 'a',
        proposedScope: 'p',
        confidence: 'low',
      }),
      ctx('find_404'),
    )
    // #then
    expect(anonymous.status).toBe(401)
    expect(list.status).toBe(401)
    expect(unknown.status).toBe(404)
  })

  it('fails closed on GitHub-backed contributor actions when GitHub is not configured', async () => {
    // #given no GITHUB_TOKEN in this environment
    // #when
    const res = await routes.workClaim(request('POST', {}, { prUrl: 'https://github.com/a/b/pull/1' }), ctx('task_001'))
    // #then
    expect(res.status).toBe(503)
  })

  it('runs the cron tick only for Vercel with the cron secret', async () => {
    // #given no CRON_SECRET configured
    // #when
    const res = await routes.cron(request('GET', { authorization: 'Bearer anything' }))
    // #then
    expect(res.status).toBe(503)
  })
})
