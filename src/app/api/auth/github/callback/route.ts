import { timingSafeEqual } from 'node:crypto'
import { getApp } from '@/server/container'
import { OAUTH_STATE_COOKIE, signInFromCode, type SignIn } from '@/server/github/oauth'
import { signedInHintCookie } from '@/lib/signed-in-hint'
import { accessRequestMessage, notifyOperator } from '@/server/notify'
import { OWNER_COOKIE, OWNER_SESSION_MS, issueOwnerSession, readCookie } from '@/server/owner'

export const dynamic = 'force-dynamic'

/**
 * Lands back on our own origin with a tiny page instead of an HTTP redirect:
 * the session cookie is SameSite=Strict, and a redirect chain that started on
 * github.com would not send it on the next hop.
 */
function finish(path: string, cookies: string[]): Response {
  const response = new Response(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${path}"><title>Signing in</title><p>Signing in…</p>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
  for (const cookie of cookies) response.headers.append('set-cookie', cookie)
  return response
}

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function GET(request: Request) {
  const { config, clock, teams } = await getApp()
  const url = new URL(request.url)
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  const clearState = `${OAUTH_STATE_COOKIE}=; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  if (!config.githubApp || !config.sessionSecret) return finish('/console?error=github_not_configured', [clearState])
  if (!sameState(readCookie(request, OAUTH_STATE_COOKIE), url.searchParams.get('state'))) {
    return finish('/console?error=state', [clearState])
  }
  const code = url.searchParams.get('code')
  if (!code) return finish('/console?error=denied', [clearState])

  let signIn: SignIn
  try {
    signIn = await signInFromCode({
      clientId: config.githubApp.clientId,
      clientSecret: config.githubApp.clientSecret,
      code,
      redirectUri: `${url.origin}/api/auth/github/callback`,
    })
  } catch (error) {
    console.error('github sign-in failed', error)
    return finish('/console?error=github', [clearState])
  }
  const { login } = signIn
  const operator = config.ownerGithubLogins.includes(login.toLowerCase())
  // Without an answer from GitHub, keep what was known and let only operators in.
  if (signIn.teams === null && !operator) return finish('/console?error=github', [clearState])
  // GitHub said who can reach which installation just now; that replaces whatever was known before.
  if (signIn.teams !== null) await teams.recordSignIn(login, signIn.teams, clock.now())
  if (!operator && signIn.teams !== null && signIn.teams.length === 0) {
    const { request: asked, people } = await teams.recordAccessRequest(login, clock.now())
    // Told directly when this deployment has its own bot; otherwise the next sweep carries it to the operator.
    if (await notifyOperator(config, accessRequestMessage(login, asked.attempts, people))) await teams.markAccessReported(login)
    return finish(`/console?error=not_owner&login=${encodeURIComponent(login)}`, [clearState])
  }
  const session = issueOwnerSession(config.sessionSecret, clock.now(), `github:${login}`)
  return finish('/console', [
    clearState,
    `${OWNER_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${OWNER_SESSION_MS / 1000}${secure}`,
    signedInHintCookie(OWNER_SESSION_MS / 1000, secure !== ''),
  ])
}
