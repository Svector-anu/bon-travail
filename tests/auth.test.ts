import { beforeAll, describe, expect, it } from 'vitest'
import { OWNER_SESSION_MS, issueOwnerSession, requireOwner, verifyOwnerSession } from '@/server/owner'
import { TEST_ENV } from './helpers'

const OWNER_TOKEN = TEST_ENV.OWNER_ACCESS_TOKEN
const NOW = Date.parse('2026-10-03T12:00:00Z')

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
  session: Plain
  externalize: Handler
  investigation: Handler
  findings: Plain
  workClaim: Handler
  cron: Plain
}

beforeAll(async () => {
  Object.assign(process.env, TEST_ENV)
  routes = {
    session: (await import('@/app/api/owner/session/route')).POST,
    externalize: (await import('@/app/api/owner/findings/[id]/externalize/route')).POST,
    investigation: (await import('@/app/api/agent/findings/[id]/investigation/route')).POST,
    findings: (await import('@/app/api/agent/findings/route')).GET,
    workClaim: (await import('@/app/api/work/[id]/claim/route')).POST,
    cron: (await import('@/app/api/cron/tick/route')).GET,
  }
})

describe('owner sessions', () => {
  it('accepts a fresh session and rejects a tampered, expired or rotated one', () => {
    // #given a session issued now
    const session = issueOwnerSession(OWNER_TOKEN, NOW)
    // #when/#then
    expect(verifyOwnerSession(OWNER_TOKEN, session, NOW + 1000)).toBe(true)
    expect(verifyOwnerSession(OWNER_TOKEN, `${session.slice(0, -1)}0`, NOW)).toBe(false)
    expect(verifyOwnerSession(OWNER_TOKEN, session, NOW + OWNER_SESSION_MS + 1)).toBe(false)
    expect(verifyOwnerSession(`${OWNER_TOKEN}-rotated`, session, NOW)).toBe(false)
    expect(verifyOwnerSession(OWNER_TOKEN, undefined, NOW)).toBe(false)
  })

  it('fails closed when no owner token is configured', () => {
    // #given no OWNER_ACCESS_TOKEN
    // #when/#then
    expect(() => requireOwner(request('POST'), undefined, NOW)).toThrow(expect.objectContaining({ code: 'UNAVAILABLE' }))
  })

  it('accepts the bearer token for scripts and rejects a wrong one', () => {
    // #given bearer headers
    // #when/#then
    expect(requireOwner(request('POST', { authorization: `Bearer ${OWNER_TOKEN}` }), OWNER_TOKEN, NOW)).toBe('owner')
    expect(() => requireOwner(request('POST', { authorization: 'Bearer nope' }), OWNER_TOKEN, NOW)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    )
  })

  it('only accepts a cookie-authenticated write from the site itself', () => {
    // #given a valid session cookie
    const session = issueOwnerSession(OWNER_TOKEN, NOW)
    // #when/#then same origin passes, cross origin and missing origin do not, reads need no origin
    expect(requireOwner(request('POST', { ...cookie(session), origin: 'http://console.test' }), OWNER_TOKEN, NOW)).toBe('owner')
    expect(() => requireOwner(request('POST', { ...cookie(session), origin: 'https://evil.test' }), OWNER_TOKEN, NOW)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    )
    expect(() => requireOwner(request('POST', cookie(session)), OWNER_TOKEN, NOW)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    expect(() => requireOwner(request('POST', { ...cookie(session), origin: 'null' }), OWNER_TOKEN, NOW)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    )
    expect(requireOwner(request('GET', cookie(session)), OWNER_TOKEN, NOW)).toBe('owner')
  })
})

describe('HTTP boundaries', () => {
  it('signs the engineer in only with the right token, as an httpOnly strict cookie', async () => {
    // #given the session endpoint
    // #when
    const wrong = await routes.session(request('POST', {}, { token: 'x'.repeat(40) }))
    const right = await routes.session(request('POST', {}, { token: OWNER_TOKEN }))
    // #then
    expect(wrong.status).toBe(401)
    expect(right.status).toBe(200)
    expect(right.headers.get('set-cookie')).toMatch(/^pw_owner=v1\.\d+\.[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict/)
  })

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
