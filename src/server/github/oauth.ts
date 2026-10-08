import { GitHubUnavailableError } from './client'

export const OAUTH_STATE_COOKIE = 'pw_oauth_state'

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, allow_signup: 'false' })
  return `https://github.com/login/oauth/authorize?${params}`
}

export type TeamRole = 'admin' | 'engineer'

/** A team is the GitHub account (org or user) an installation of the app belongs to. */
export interface TeamAccess {
  team: string
  installationId: number
  role: TeamRole
}

export interface SignIn {
  login: string
  /** The installations this person can reach, and their strongest permission on any repo in each. Null when GitHub could not say. */
  teams: TeamAccess[] | null
}

const API = 'https://api.github.com'
const MAX_INSTALLATIONS = 30
const MAX_REPO_PAGES = 5

function headers(token: string): Record<string, string> {
  return { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'bon-travail', 'x-github-api-version': '2022-11-28' }
}

async function getJson(fetchImpl: typeof fetch, path: string, token: string): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetchImpl(`${API}${path}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    throw new GitHubUnavailableError(`GitHub is unreachable: ${path}`, { cause: error })
  }
  if (!response.ok) throw new GitHubUnavailableError(`GitHub ${response.status} for ${path}`)
  return ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
}

/** GitHub's repo permissions, reduced to what the console needs: admins fund and decide, writers triage. */
export function roleFromPermissions(permissions: unknown): TeamRole | null {
  const p = (permissions && typeof permissions === 'object' ? permissions : {}) as Record<string, unknown>
  if (p.admin === true) return 'admin'
  if (p.maintain === true || p.push === true) return 'engineer'
  return null
}

/**
 * Which installations of this app the person can reach, read with their own
 * token. GitHub only lists installations and repositories the user can access,
 * so membership comes from GitHub itself, never from what the browser says.
 */
export async function teamsForUser(token: string, fetchImpl: typeof fetch = fetch): Promise<TeamAccess[]> {
  const installs = await getJson(fetchImpl, '/user/installations?per_page=100', token)
  const list = (Array.isArray(installs.installations) ? installs.installations : []).slice(0, MAX_INSTALLATIONS) as Record<string, unknown>[]
  const teams: TeamAccess[] = []
  for (const install of list) {
    const installationId = Number(install.id)
    const account = String((install.account as Record<string, unknown> | undefined)?.login ?? '').toLowerCase()
    if (!installationId || !account) continue
    let role: TeamRole | null = null
    for (let page = 1; page <= MAX_REPO_PAGES && role !== 'admin'; page++) {
      const body = await getJson(fetchImpl, `/user/installations/${installationId}/repositories?per_page=100&page=${page}`, token)
      const repos = (Array.isArray(body.repositories) ? body.repositories : []) as Record<string, unknown>[]
      for (const repo of repos) {
        const r = roleFromPermissions(repo.permissions)
        if (r === 'admin') role = 'admin'
        else if (r === 'engineer' && role === null) role = 'engineer'
      }
      if (repos.length < 100) break
    }
    if (role) teams.push({ team: account, installationId, role })
  }
  return teams
}

/**
 * Exchanges the OAuth code for a user token and returns who signed in and
 * which teams GitHub says they belong to. The token is used here and never
 * stored.
 */
export async function signInFromCode(
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SignIn> {
  const { login, token } = await userFromCode(input, fetchImpl)
  try {
    return { login, teams: await teamsForUser(token, fetchImpl) }
  } catch (error) {
    // Who signed in is known; which teams they are on is not. Callers must not read that as "no teams".
    console.error('github team lookup failed', error instanceof Error ? error.message : error)
    return { login, teams: null }
  }
}

async function userFromCode(
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl: typeof fetch,
): Promise<{ login: string; token: string }> {
  let tokenResponse: Response
  try {
    tokenResponse = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'bon-travail' },
      body: JSON.stringify({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new GitHubUnavailableError('GitHub sign-in is unreachable', { cause: error })
  }
  const token = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string; error?: string }
  if (!token.access_token) throw new GitHubUnavailableError(`GitHub sign-in failed: ${token.error ?? tokenResponse.status}`)

  const userResponse = await fetchImpl('https://api.github.com/user', {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token.access_token}`, 'user-agent': 'bon-travail' },
    signal: AbortSignal.timeout(15_000),
  })
  const user = (await userResponse.json().catch(() => ({}))) as { login?: string }
  if (!userResponse.ok || !user.login) throw new GitHubUnavailableError('GitHub did not return the signed-in user')
  return { login: user.login, token: token.access_token }
}
