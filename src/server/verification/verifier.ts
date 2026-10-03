import type { Submission, TaskKind, TaskRecord, VerificationResult } from '@/domain/types'

/**
 * The verifier could not reach a verdict (chain unreachable, GitHub down,
 * chain disagrees with the task snapshot). The worker is not penalised; the
 * agent retries.
 */
export class VerificationUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'VerificationUnavailableError'
  }
}

/** The independent judge has not finished yet (CI still running, merge pending). Retry later. */
export class VerificationPendingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerificationPendingError'
  }
}

export interface TaskVerifier {
  readonly kind: TaskKind
  readonly name: string
  verify(task: TaskRecord, submission: Submission): Promise<VerificationResult>
}

export class VerifierRegistry {
  private readonly verifiers = new Map<TaskKind, TaskVerifier>()

  constructor(verifiers: readonly TaskVerifier[]) {
    for (const verifier of verifiers) this.verifiers.set(verifier.kind, verifier)
  }

  for(kind: TaskKind): TaskVerifier {
    const verifier = this.verifiers.get(kind)
    if (!verifier) throw new Error(`No verifier registered for task kind ${kind}`)
    return verifier
  }
}
