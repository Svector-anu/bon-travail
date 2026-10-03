import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { DomainError } from './errors'

export const OWNER_COOKIE = 'pw_owner'
export const OWNER_SESSION_MS = 7 * 24 * 60 * 60 * 1000
const OWNER_ACTOR = 'owner'

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function sessionKey(ownerToken: string): Buffer {
  return createHash('sha256').update(`proofwork-owner-session:${ownerToken}`).digest()
}

/** A session is "v1.<issuedAt>.<hmac>"; rotating OWNER_ACCESS_TOKEN invalidates every session. */
export function issueOwnerSession(ownerToken: string, now: number): string {
  const issuedAt = String(now)
  const mac = createHmac('sha256', sessionKey(ownerToken)).update(issuedAt).digest('hex')
  return `v1.${issuedAt}.${mac}`
}

export function verifyOwnerSession(ownerToken: string, value: string | undefined, now: number): boolean {
  if (!value) return false
  const [version, issuedAt, mac] = value.split('.')
  if (version !== 'v1' || !issuedAt || !mac || !/^\d+$/.test(issuedAt)) return false
  const age = now - Number(issuedAt)
  if (age < 0 || age > OWNER_SESSION_MS) return false
  const expected = createHmac('sha256', sessionKey(ownerToken)).update(issuedAt).digest('hex')
  return safeEqual(mac, expected)
}

export function ownerTokenMatches(ownerToken: string, presented: string): boolean {
  return safeEqual(presented, ownerToken)
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('cookie') ?? ''
  const match = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined
}

/**
 * Engineer-only endpoints decide what work leaves the team, for how much and
 * to whom, so they fail closed: without OWNER_ACCESS_TOKEN nobody is an owner.
 * Browsers authenticate with the session cookie, and a cookie-authenticated
 * write must come from this site's own pages; scripts may send the token as a
 * bearer instead.
 */
export function requireOwner(request: Request, ownerToken: string | undefined, now: number): string {
  if (!ownerToken) throw new DomainError('UNAVAILABLE', 'OWNER_ACCESS_TOKEN is not configured; the engineer console is disabled')
  const header = request.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ')) {
    if (ownerTokenMatches(ownerToken, header.slice('Bearer '.length))) return OWNER_ACTOR
    throw new DomainError('UNAUTHORIZED', 'Invalid owner token')
  }
  if (!verifyOwnerSession(ownerToken, readCookie(request, OWNER_COOKIE), now)) {
    throw new DomainError('UNAUTHORIZED', 'Sign in to the engineer console')
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin')
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    if (!origin || !host || originHost(origin) !== host) {
      throw new DomainError('FORBIDDEN', 'Owner actions must come from the console itself')
    }
  }
  return OWNER_ACTOR
}
