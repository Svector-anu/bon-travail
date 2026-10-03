import { randomBytes } from 'node:crypto'
import type { Clock } from './clock'
import { DomainError } from './errors'
import type { Store } from './store/store'

/**
 * Public endpoints that call GitHub on the server's token. A short per-key
 * lease keeps them from being used to burn the rate limit; the lease simply
 * expires, it is never released early.
 */
export async function throttle(app: { store: Store; clock: Clock }, key: string, spacingMs = 5_000): Promise<void> {
  const now = app.clock.now()
  // A random holder per call: a lease lets its own holder back in, so a shared value would let concurrent calls through.
  if (!(await app.store.acquireLease(`throttle:${key}`, randomBytes(8).toString('hex'), now, spacingMs))) {
    throw new DomainError('CONFLICT', 'That was just tried. Wait a few seconds and try again.')
  }
}
