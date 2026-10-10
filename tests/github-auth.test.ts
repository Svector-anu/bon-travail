import { createVerify, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getApp } from '@/server/container'
import { GitHubApp, appJwt, normalizePem } from '@/server/github/app'
import { verifyOwnerSession } from '@/server/owner'
import { TEST_ENV } from './helpers'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const SECRET = 'session-secret-session-secret-0000'
const BASE = 'https://console.test'

type Get = (request: Request) => Promise<Response>
let routes: { start: Get; callback: Get }

beforeAll(async () => {
  Object.assign(process.env, TEST_ENV, {
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: Buffer.from(PEM).toString('base64'),
    GITHUB_APP_SLUG: 'bon-travail-test',
    GITHUB_APP_CLIENT_ID: 'Iv1.client',
    GITHUB_APP_CLIENT_SECRET: 'client-secret',
    OWNER_GITHUB_LOGINS: 'Octocat, @hubot',
    SESSION_SECRET: SECRET,
  })
  routes = {
    start: (await import('@/app/api/auth/github/start/route')).GET,
    callback: (await import('@/app/api/auth/github/callback/route')).GET,
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface StubInstallation {
  id: number
  account: string
  permissions: Record<string, boolean>
}

/**
 * GitHub's OAuth token exchange, /user, and the installations the user can
 * reach, answering as the given login. `installations: null` makes GitHub
 * fail the installations lookup.
 */
function stubGitHubLogin(login: string, installations: StubInstallation[] | null = []) {
  const fetchMock = vi.fn<(url: string | URL) => Promise<Response>>(async (url) => {
    const u = String(url)
    if (u.startsWith('https://github.com/login/oauth/access_token')) return json({ access_token: 'gho_user' })
    if (u === 'https://api.github.com/user') return json({ login })
    if (u.startsWith('https://api.github.com/user/installations?')) {
      return installations === null ? json({}, 502) : json({ installations: installations.map((i) => ({ id: i.id, account: { login: i.account } })) })
    }
    const repos = /^https:\/\/api\.github\.com\/user\/installations\/(\d+)\/repositories/.exec(u)
    if (repos && installations) {
      const install = installations.find((i) => i.id === Number(repos[1]))
      return json({ repositories: install ? [{ name: 'sdk', permissions: install.permissions }] : [] })
    }
    return json({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function startSignIn(): Promise<{ state: string; cookie: string; location: string }> {
  const response = await routes.start(new Request(`${BASE}/api/auth/github/start`))
  const location = response.headers.get('location') ?? ''
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0]!
  return { state: new URL(location).searchParams.get('state') ?? '', cookie, location }
}

function sessionFrom(response: Response): string | undefined {
  const set = response.headers.getSetCookie().find((c) => c.startsWith('pw_owner='))
  return set?.split(';')[0]?.slice('pw_owner='.length)
}

describe('Sign in with GitHub', () => {
  it('sends the engineer to GitHub with a state tied to this browser', async () => {
    // #given the app is configured
    // #when
    const { location, cookie, state } = await startSignIn()
    // #then
    expect(location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/)
    expect(new URL(location).searchParams.get('client_id')).toBe('Iv1.client')
    expect(new URL(location).searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/github/callback`)
    expect(cookie).toBe(`pw_oauth_state=${state}`)
    expect(state).toMatch(/^[0-9a-f]{48}$/)
  })

  it('signs in a listed login, case-insensitively, as a GitHub actor', async () => {
    // #given octocat completes GitHub sign-in
    const { state, cookie } = await startSignIn()
    stubGitHubLogin('octocat')
    // #when
    const response = await routes.callback(new Request(`${BASE}/api/auth/github/callback?code=abc&state=${state}`, { headers: { cookie } }))
    // #then
    const session = sessionFrom(response)
    expect(await response.text()).toContain('url=/console"')
    expect(response.headers.getSetCookie().find((c) => c.startsWith('pw_owner='))).toMatch(/HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/)
    expect(verifyOwnerSession(SECRET, session, Date.now())).toBe('github:octocat')
  })

  it('refuses a login that is not on the list', async () => {
    // #given mallory completes GitHub sign-in
    const { state, cookie } = await startSignIn()
    stubGitHubLogin('mallory')
    // #when
    const response = await routes.callback(new Request(`${BASE}/api/auth/github/callback?code=abc&state=${state}`, { headers: { cookie } }))
    // #then
    expect(sessionFrom(response)).toBeUndefined()
    expect(await response.text()).toContain('error=not_owner&login=mallory')
  })

  it('lets in someone GitHub says can write to a repo the app is installed on, as an engineer of that team', async () => {
    // #given sparker can push to a repo in the YouDotCom installation
    const { state, cookie } = await startSignIn()
    stubGitHubLogin('Sparker', [{ id: 77, account: 'YouDotCom', permissions: { push: true } }])
    // #when
    const response = await routes.callback(new Request(`${BASE}/api/auth/github/callback?code=abc&state=${state}`, { headers: { cookie } }))
    // #then signed in, and recorded on that team only
    expect(verifyOwnerSession(SECRET, sessionFrom(response), Date.now())).toBe('github:Sparker')
    const { teams } = await getApp()
    const access = await teams.membershipsOf('sparker')
    expect([...access.teams]).toEqual([['youdotcom', 'engineer']])
    expect([...access.repos]).toEqual([['youdotcom/sdk', 'engineer']])
  })

  it('counts someone who is on no team, so the operator can be told', async () => {
    // #given eve signs in twice and reaches no installation
    for (let i = 0; i < 2; i++) {
      const { state, cookie } = await startSignIn()
      stubGitHubLogin('eve')
      await routes.callback(new Request(`${BASE}/api/auth/github/callback?code=abc&state=${state}`, { headers: { cookie } }))
    }
    // #then
    const { teams } = await getApp()
    expect((await teams.listAccessRequests()).find((r) => r.login === 'eve')).toMatchObject({ attempts: 2 })
  })

  it('does not mistake a GitHub hiccup for "no team": others are asked to retry, operators still get in', async () => {
    // #given GitHub fails the installations lookup
    const first = await startSignIn()
    stubGitHubLogin('mallory', null)
    const refused = await routes.callback(new Request(`${BASE}/api/auth/github/callback?code=abc&state=${first.state}`, { headers: { cookie: first.cookie } }))
    const second = await startSignIn()
    stubGitHubLogin('octocat', null)
    const operator = await routes.callback(new Request(`${BASE}/api/auth/github/callback?code=abc&state=${second.state}`, { headers: { cookie: second.cookie } }))
    // #then
    expect(await refused.text()).toContain('error=github')
    expect(verifyOwnerSession(SECRET, sessionFrom(operator), Date.now())).toBe('github:octocat')
  })

  it('refuses a callback whose state does not match this browser', async () => {
    // #given a valid GitHub code but a forged state
    const { cookie } = await startSignIn()
    const fetchMock = stubGitHubLogin('octocat')
    // #when
    const response = await routes.callback(new Request(`${BASE}/api/auth/github/callback?code=abc&state=forged`, { headers: { cookie } }))
    // #then the code was never exchanged and no session was issued
    expect(sessionFrom(response)).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await response.text()).toContain('error=state')
  })
})

describe('GitHub App', () => {
  it('signs app JWTs with the private key, accepting PEM in any env encoding', () => {
    // #given the key as base64 and as escaped PEM
    const fromBase64 = normalizePem(Buffer.from(PEM).toString('base64'))
    const fromEscaped = normalizePem(PEM.replace(/\n/g, '\\n'))
    // #when
    const jwt = appJwt('12345', fromBase64, Date.parse('2026-10-03T12:00:00Z'))
    const [header, payload, signature] = jwt.split('.')
    // #then
    expect(fromEscaped).toBe(fromBase64)
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${payload}`)
    expect(verifier.verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({ iss: '12345' })
  })

  it('reads each repository with a cached installation token for its own installation', async () => {
    // #given an app installed once, covering acme/sdk
    const calls: string[] = []
    const fetchMock = vi.fn<(url: string | URL) => Promise<Response>>(async (url) => {
      calls.push(String(url).replace('https://api.github.com', ''))
      if (String(url).endsWith('/repos/acme/sdk/installation')) return json({ id: 77 })
      if (String(url).endsWith('/app/installations/77/access_tokens')) return json({ token: 'ghs_inst', expires_at: '2026-10-03T13:00:00Z' })
      return json({}, 404)
    })
    const app = new GitHubApp({ appId: '12345', privateKey: PEM, slug: 'bon-travail-test' }, fetchMock as unknown as typeof fetch, () =>
      Date.parse('2026-10-03T12:00:00Z'),
    )
    // #when the same repository is read twice
    const first = await app.forRepo('acme', 'sdk')
    const second = await app.forRepo('acme', 'sdk')
    // #then one lookup and one token mint, then the cache
    expect([first, second]).toEqual(['ghs_inst', 'ghs_inst'])
    expect(calls).toEqual(['/repos/acme/sdk/installation', '/app/installations/77/access_tokens'])
    expect(app.installUrl).toBe('https://github.com/apps/bon-travail-test/installations/new')
  })

  it('treats a repository the app is not installed on as not found', async () => {
    // #given GitHub answers 404 for the installation lookup
    const app = new GitHubApp(
      { appId: '12345', privateKey: PEM, slug: 'bon-travail-test' },
      (async () => json({ message: 'Not Found' }, 404)) as unknown as typeof fetch,
    )
    // #when/#then
    await expect(app.forRepo('acme', 'private-thing')).rejects.toMatchObject({ name: 'GitHubNotFoundError' })
  })
})
