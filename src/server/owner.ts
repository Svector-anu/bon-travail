import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { AppConfig } from './config'
import { DomainError } from './errors'

export const OWNER_COOKIE = 'pw_owner'
export const OWNER_SESSION_MS = 7 * 24 * 60 * 60 * 1000

/** How the console is protected in this deployment. Every field unset = console off. */
export interface OwnerAuth {
  /** Bearer token for scripts and CI. */
  accessToken?: string
  /** Signs session cookies. */
  sessionSecret?: string
  /** Operators: GitHub logins that run bon travail and see every team (lowercase). */
  githubLogins: readonly string[]
}

export function ownerAuth(config: Pick<AppConfig, 'ownerAccessToken' | 'sessionSecret' | 'ownerGithubLogins'>): OwnerAuth {
  return { accessToken: config.ownerAccessToken, sessionSecret: config.sessionSecret, githubLogins: config.ownerGithubLogins }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function sessionKey(secret: string): Buffer {
  return createHash('sha256').update(`proofwork-owner-session:${secret}`).digest()
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', sessionKey(secret)).update(body).digest('hex')
}

/**
 * A session is "v2.<issuedAt>.<actor, base64url>.<hmac>". The actor is who
 * signed in ("github:octocat"); rotating the session secret ends every session.
 */
export function issueOwnerSession(secret: string, now: number, actor: string): string {
  const body = `${now}.${Buffer.from(actor).toString('base64url')}`
  return `v2.${body}.${mac(secret, body)}`
}

/** Returns the signed-in actor, or null for anything missing, tampered or expired. */
export function verifyOwnerSession(secret: string, value: string | undefined, now: number): string | null {
  if (!value) return null
  const [version, issuedAt, actor64, signature] = value.split('.')
  if (version !== 'v2' || !issuedAt || !actor64 || !signature || !/^\d+$/.test(issuedAt)) return null
  const age = now - Number(issuedAt)
  if (age < 0 || age > OWNER_SESSION_MS) return null
  if (!safeEqual(signature, mac(secret, `${issuedAt}.${actor64}`))) return null
  return Buffer.from(actor64, 'base64url').toString('utf8')
}

export function ownerTokenMatches(ownerToken: string, presented: string): boolean {
  return safeEqual(presented, ownerToken)
}

/** Operators: the access token, or a GitHub login on the operator list. Team members are checked against GitHub separately. */
export function actorAllowed(actor: string, auth: OwnerAuth): boolean {
  if (actor === 'owner') return Boolean(auth.accessToken)
  if (actor.startsWith('github:')) return auth.githubLogins.includes(actor.slice('github:'.length).toLowerCase())
  return false
}

export function ownerConsoleEnabled(auth: OwnerAuth): boolean {
  return Boolean(auth.accessToken) || Boolean(auth.sessionSecret)
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('cookie') ?? ''
  const match = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined
}

/**
 * Console endpoints decide what work leaves a team, for how much and to whom,
 * so they fail closed. Browsers authenticate with the session cookie from
 * "Sign in with GitHub"; a cookie-authenticated write must come from this
 * site's own pages. Scripts may send OWNER_ACCESS_TOKEN as a bearer instead.
 * Returns the signed-in actor; whether they are an operator or on a team is
 * decided by the caller.
 */
export function requireSession(request: Request, auth: OwnerAuth, now: number): string {
  if (!ownerConsoleEnabled(auth)) {
    throw new DomainError('UNAVAILABLE', 'The engineer console is not configured in this deployment')
  }
  const header = request.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ')) {
    if (auth.accessToken && ownerTokenMatches(auth.accessToken, header.slice('Bearer '.length))) return 'owner'
    throw new DomainError('UNAUTHORIZED', 'Invalid owner token')
  }
  const actor = auth.sessionSecret ? verifyOwnerSession(auth.sessionSecret, readCookie(request, OWNER_COOKIE), now) : null
  if (!actor || !actor.startsWith('github:')) throw new DomainError('UNAUTHORIZED', 'Sign in to the engineer console')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin')
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    if (!origin || !host || originHost(origin) !== host) {
      throw new DomainError('FORBIDDEN', 'Owner actions must come from the console itself')
    }
  }
  return actor
}
