import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { field, handle, json, readBody } from '@/server/http'
import { OWNER_COOKIE, OWNER_SESSION_MS, issueOwnerSession, ownerTokenMatches } from '@/server/owner'

function cookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${OWNER_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`
}

/** Exchanges the owner access token for a signed, httpOnly session cookie. */
export async function POST(request: Request) {
  return handle(async () => {
    const { config, clock } = await getApp()
    if (!config.ownerAccessToken) throw new DomainError('UNAVAILABLE', 'OWNER_ACCESS_TOKEN is not configured; the engineer console is disabled')
    const token = field(await readBody(request), 'token', 256)
    if (!ownerTokenMatches(config.ownerAccessToken, token)) throw new DomainError('UNAUTHORIZED', 'That access token is not right')
    const secure = new URL(request.url).protocol === 'https:'
    const response = json({ ok: true })
    response.headers.append('set-cookie', cookie(issueOwnerSession(config.ownerAccessToken, clock.now()), OWNER_SESSION_MS / 1000, secure))
    return response
  })
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const response = json({ ok: true })
    response.headers.append('set-cookie', cookie('', 0, new URL(request.url).protocol === 'https:'))
    return response
  })
}
