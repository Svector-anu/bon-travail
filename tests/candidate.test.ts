import { describe, expect, it } from 'vitest'
import type { Investigation } from '@/domain/findings'
import type { FindingView } from '@/domain/views'
import { preparation } from '@/lib/candidate'

const investigation: Investigation = {
  author: 'aeon',
  runUrl: 'https://github.com/o/aeon/actions/runs/1',
  summary: 'formatUsdc drops the second decimal since 52dda7f.',
  rootCause: 'slice(0, 1) keeps only the first fraction digit.',
  reproduction: ['git checkout 52dda7f', 'npm test'],
  firstBadSha: '52dda7fe5c8c24d2c10002e087e348a4ceeb57ea',
  bisectMethod: 'one commit in the window',
  proposedAcceptance: 'examples passes on main.',
  proposedScope: 'Fix formatUsdc.',
  suggestedProtectedPaths: ['test/'],
  confidence: 'high',
  commands: [{ command: 'npm test', sha: '52dda7f', outcome: 'failed', note: null }],
  submittedAt: 2_000,
}

function finding(patch: Partial<FindingView> = {}): FindingView {
  return {
    id: 'find_1',
    displayId: 'FIND-001',
    repo: 'o/r',
    jobName: 'examples',
    stepName: 'Run examples',
    status: 'investigated',
    failureCount: 3,
    firstFailedAt: 1_000,
    lastFailedAt: 1_500,
    lastFailedRunUrl: 'https://github.com/o/r/actions/runs/9',
    recurrenceCount: 0,
    investigated: true,
    investigationSummary: investigation.summary,
    taskId: null,
    repoUrl: 'https://github.com/o/r',
    workflowName: 'Examples',
    workflowPath: '.github/workflows/examples.yml',
    defaultBranch: 'main',
    stepCommand: 'npm test',
    errorExcerpt: "'1.5' !== '1.50'",
    firstFailedSha: '52dda7f',
    regression: {
      lastGreenSha: '318456f',
      lastGreenRunUrl: null,
      firstRedSha: '52dda7f',
      compareUrl: null,
      commits: [{ sha: '52dda7f', message: 'perf: shorten formatUsdc', author: 'a', url: 'https://github.com/o/r/commit/52dda7f' }],
      files: ['src/usdc.js'],
      truncated: false,
    },
    investigation,
    decidedBy: null,
    decidedAt: null,
    resolvedAt: null,
    resolvedSha: null,
    lastRecurrenceAt: null,
    runs: [],
    events: [],
    ...patch,
  }
}

const states = (f: FindingView) => Object.fromEntries(preparation(f).map((item) => [item.key, item.state]))

describe('what Aeon did before asking', () => {
  it('marks each step done only when the record proves it', () => {
    // #given a finding with a log, a regression window and a current investigation
    // #then the reproduction, the bisect and the proposed acceptance all count as done
    expect(states(finding())).toEqual({
      noticed: 'done',
      log: 'done',
      window: 'done',
      reproduced: 'done',
      bisected: 'done',
      acceptance: 'done',
      watch: 'pending',
    })
  })

  it('shows the investigation as still to come before Aeon has run', () => {
    // #given a fresh candidate Aeon has not investigated
    const prep = states(finding({ status: 'candidate', investigation: null, investigated: false, investigationSummary: null }))

    // #then nothing it has not done is claimed
    expect([prep.reproduced, prep.bisected, prep.acceptance]).toEqual(['pending', 'pending', 'pending'])
  })

  it('does not reuse an investigation from before the failure came back', () => {
    // #given an investigation older than the latest recurrence
    const prep = states(finding({ status: 'recurred', recurrenceCount: 1, lastRecurrenceAt: 3_000 }))

    // #then the new episode is treated as not yet investigated
    expect(prep.reproduced).toBe('pending')
  })

  it('does not promise an investigation once the engineer has decided', () => {
    // #given a finding handed to a human before Aeon investigated it
    const prep = states(finding({ status: 'externalized', investigation: null, investigated: false, investigationSummary: null }))

    // #then the steps Aeon will not take are marked as not done, not as coming
    expect([prep.reproduced, prep.bisected, prep.acceptance]).toEqual(['skipped', 'skipped', 'skipped'])
  })

  it('says plainly when there was no green run to compare against', () => {
    // #given a workflow that has never been green on record
    const prep = states(finding({ regression: { ...finding().regression!, lastGreenSha: null } }))

    // #then the narrowing step is marked as not possible
    expect(prep.window).toBe('skipped')
  })
})
