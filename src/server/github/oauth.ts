import { GitHubUnavailableError } from './client'

export const OAUTH_STATE_COOKIE = 'pw_oauth_state'

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, allow_signup: 'false' })
  return `https://github.com/login/oauth/authorize?${params}`
}

/**
 * Exchanges the OAuth code for a user token and returns the GitHub login it
 * belongs to. The token is used once, here, and never stored: the console
 * only needs to know who signed in.
 */
export async function loginFromCode(
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
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
  return user.login
}
