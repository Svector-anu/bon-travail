export type DomainErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'GONE'
  | 'UNAVAILABLE'

const STATUS: Record<DomainErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  UNAVAILABLE: 503,
}

/** An expected, user-facing failure with a stable code and HTTP status. */
export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly status: number

  constructor(code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.status = STATUS[code]
  }
}
