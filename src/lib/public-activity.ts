import type { AgentRunRecord } from '@/domain/types'

/** What the public may read about a run that is not tied to published work: what kind of thing happened, never which repository. */
const PUBLIC_RUN_DETAIL: Record<string, string> = {
  observe: 'Read new workflow runs on a connected repository',
  detect: 'Noticed a new failure on a connected repository',
  repeat: 'A failure repeated; evidence gathered for the team',
  resolve: 'A watched failure is green again',
  recur: 'A fixed failure came back; the team was told',
}

/**
 * A run tied to a work package is public, because the team chose to post that
 * work. Any other run can name a private repository or a failure the team has
 * not decided on, so the public sees only what kind of thing happened.
 */
export function publicRun<T extends Pick<AgentRunRecord, 'taskId' | 'action' | 'detail' | 'error'>>(run: T): T {
  if (run.taskId) return run
  return { ...run, detail: PUBLIC_RUN_DETAIL[run.action] ?? 'Routine agent work', error: run.error ? 'Something needs the team' : null }
}
