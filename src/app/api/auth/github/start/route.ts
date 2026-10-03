import { randomBytes } from 'node:crypto'
import { getApp } from '@/server/container'
import { OAUTH_STATE_COOKIE, authorizeUrl } from '@/server/github/oauth'

export const dynamic = 'force-dynamic'

/** Starts "Sign in with GitHub". The state cookie ties the callback to this browser. */
export async function GET(request: Request) {
  const { config } = await getApp()
  const url = new URL(request.url)
  if (!config.githubApp) return Response.redirect(new URL('/console?error=github_not_configured', url), 303)
  const state = randomBytes(24).toString('hex')
  const redirectUri = `${url.origin}/api/auth/github/callback`
  const response = new Response(null, { status: 303, headers: { location: authorizeUrl(config.githubApp.clientId, redirectUri, state) } })
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  response.headers.append('set-cookie', `${OAUTH_STATE_COOKIE}=${state}; Path=/api/auth/github; HttpOnly; SameSite=Lax; Max-Age=600${secure}`)
  return response
}
