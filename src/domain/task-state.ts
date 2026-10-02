export const TASK_STATES = [
  'DRAFT',
  'FUNDED',
  'OPEN',
  'CLAIMED',
  'SUBMITTED',
  'VERIFYING',
  'ACCEPTED',
  'PAID',
  'REJECTED',
  'EXPIRED',
  'REFUNDED',
] as const

export type TaskState = (typeof TASK_STATES)[number]

/**
 * Every legal edge in the task lifecycle. Anything not listed here throws.
 *
 * ACCEPTED sits between a passing verification and a confirmed payout so a
 * failed payment never loses the fact that the worker earned it: the agent
 * retries the (idempotent) release until it settles.
 */
const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  DRAFT: ['FUNDED'],
  FUNDED: ['OPEN'],
  OPEN: ['CLAIMED', 'EXPIRED'],
  CLAIMED: ['SUBMITTED', 'OPEN', 'EXPIRED'],
  SUBMITTED: ['VERIFYING'],
  VERIFYING: ['ACCEPTED', 'REJECTED', 'SUBMITTED'],
  ACCEPTED: ['PAID'],
  PAID: [],
  REJECTED: ['OPEN', 'EXPIRED'],
  EXPIRED: ['REFUNDED'],
  REFUNDED: [],
}

export const TERMINAL_STATES: readonly TaskState[] = ['PAID', 'REFUNDED']

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to)
}

export class IllegalTransitionError extends Error {
  readonly from: TaskState
  readonly to: TaskState

  constructor(taskId: string, from: TaskState, to: TaskState) {
    super(`Illegal transition for ${taskId}: ${from} -> ${to}`)
    this.name = 'IllegalTransitionError'
    this.from = from
    this.to = to
  }
}

export function assertTransition(taskId: string, from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(taskId, from, to)
}

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state)
}
