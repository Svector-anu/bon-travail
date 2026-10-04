import { INVESTIGABLE, investigationIsCurrent } from '@/domain/findings'
import type { FindingView } from '@/domain/views'

export type PrepState = 'done' | 'pending' | 'skipped'

export interface PrepItem {
  key: string
  state: PrepState
  text: string
}

const short = (sha: string) => sha.slice(0, 7)

/**
 * The boring work Aeon did before a human was asked to act, read from the
 * finding itself. Every line is a fact the record supports: an item is only
 * `done` when the data that proves it is there, `pending` when Aeon will do
 * it on a later run, and `skipped` when it was not possible.
 */
export function preparation(finding: FindingView): PrepItem[] {
  const current = investigationIsCurrent(finding)
  const inv = current ? finding.investigation : null
  const window = finding.regression
  const commits = window?.commits.length ?? 0
  const reproduced = inv !== null && (inv.reproduction.length > 0 || inv.commands.some((c) => c.outcome === 'failed'))
  // Aeon only investigates findings still waiting on a decision; once decided, what was not done will not be.
  const later: PrepState = INVESTIGABLE.includes(finding.status) ? 'pending' : 'skipped'

  return [
    {
      key: 'noticed',
      state: 'done',
      text: `Noticed "${finding.stepName}" failing ${finding.failureCount} ${finding.failureCount === 1 ? 'time' : 'times'} in a row`,
    },
    {
      key: 'log',
      state: finding.errorExcerpt ? 'done' : 'skipped',
      text: finding.errorExcerpt ? 'Pulled the failing log from GitHub' : 'No readable log in the failing run',
    },
    {
      key: 'window',
      state: window?.lastGreenSha ? 'done' : 'skipped',
      text: window?.lastGreenSha
        ? `Narrowed it to ${commits === 1 ? 'one commit' : `${commits}${window.truncated ? '+' : ''} commits`} since the last green run`
        : 'No green run before it to compare against',
    },
    {
      key: 'reproduced',
      state: reproduced ? 'done' : later,
      text: reproduced ? 'Reproduced it in its own runner' : later === 'pending' ? 'Reproducing it in its own runner on the next run' : 'Not reproduced before the decision',
    },
    {
      key: 'bisected',
      state: inv?.firstBadSha ? 'done' : inv ? 'skipped' : later,
      text: inv?.firstBadSha
        ? `Found the first bad commit, ${short(inv.firstBadSha)}`
        : inv
          ? 'Could not pin a single bad commit'
          : later === 'pending'
            ? 'Looking for the first bad commit'
            : 'No bisect before the decision',
    },
    {
      key: 'acceptance',
      state: inv ? 'done' : later,
      text: inv ? 'Proposed how a fix should be judged' : later === 'pending' ? 'Will propose how a fix should be judged' : 'You set how a fix is judged',
    },
    {
      key: 'watch',
      state: 'pending',
      text: finding.recurrenceCount > 0 ? `Watching for it to come back (it has, ${finding.recurrenceCount}×)` : 'Will keep watching for it to come back after a fix',
    },
  ]
}

/** The headline label for a candidate, from where it stands. */
export function candidateLabel(finding: Pick<FindingView, 'status' | 'recurrenceCount'>): string {
  switch (finding.status) {
    case 'recurred':
      return 'Came back'
    case 'internal':
      return 'Kept internal'
    case 'externalized':
      return 'With a human'
    case 'resolved':
      return 'Fixed, still watching'
    case 'dismissed':
      return 'Dismissed'
    case 'watching':
      return 'Failed once'
    default:
      return 'Repeated failure'
  }
}
