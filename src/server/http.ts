import { timingSafeEqual } from 'node:crypto'
import { getApp } from './container'
import { DomainError } from './errors'

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

const STATUS_BY_ERROR: Record<string, { code: string; status: number }> = {
  NotFoundError: { code: 'NOT_FOUND', status: 404 },
  StaleStateError: { code: 'CONFLICT', status: 409 },
  IllegalTransitionError: { code: 'CONFLICT', status: 409 },
  PaymentPolicyError: { code: 'PAYMENT_POLICY', status: 422 },
  PaymentConfigError: { code: 'PAYMENT_NOT_CONFIGURED', status: 503 },
  PaymentRailError: { code: 'UNAVAILABLE', status: 503 },
  ChainUnavailableError: { code: 'UNAVAILABLE', status: 503 },
  VerificationUnavailableError: { code: 'UNAVAILABLE', status: 503 },
}

/** Maps by error name so a hot-reloaded module's classes still map correctly. */
function errorResponse(error: unknown): Response {
  if (error instanceof Error && error.name === 'DomainError') {
    const { code, status } = error as DomainError
    return json({ error: code, message: error.message }, status)
  }
  const mapped = error instanceof Error ? STATUS_BY_ERROR[error.name] : undefined
  if (error instanceof Error && mapped) return json({ error: mapped.code, message: error.message }, mapped.status)
  console.error(error)
  return json({ error: 'INTERNAL', message: 'Unexpected error' }, 500)
}

export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn()
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Agent-only endpoints move money, so they fail closed: with no
 * AGENT_API_TOKEN configured nobody can call them.
 */
export function requireAgent(request: Request): void {
  const configured = getApp().config.agentApiToken
  if (!configured) throw new DomainError('UNAVAILABLE', 'AGENT_API_TOKEN is not configured; agent endpoints are disabled')
  const header = request.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const a = Buffer.from(presented)
  const b = Buffer.from(configured)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new DomainError('UNAUTHORIZED', 'Missing or invalid agent token')
  }
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new DomainError('BAD_REQUEST', 'Body must be JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DomainError('BAD_REQUEST', 'Body must be a JSON object')
  return body as Record<string, unknown>
}

export function field(body: Record<string, unknown>, name: string, maxLength = 200): string {
  const value = body[name]
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new DomainError('BAD_REQUEST', `"${name}" must be a non-empty string`)
  }
  return value
}

export function optionalField(body: Record<string, unknown>, name: string, maxLength = 200): string | undefined {
  return body[name] === undefined ? undefined : field(body, name, maxLength)
}
