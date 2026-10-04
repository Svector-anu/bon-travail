import { describe, expect, it } from 'vitest'
import { publicRun } from '@/lib/public-activity'

const run = { taskId: null as string | null, action: 'repeat', detail: 'Failure repeated on acme/private-api; evidence gathered for review', error: null as string | null }

describe('the public agent log', () => {
  it('never names a repository for a failure the team has not posted', () => {
    // #given a run about a failure in a private repository
    // #when the public reads it
    const shown = publicRun(run)

    // #then the kind of event survives and the repository does not
    expect(shown.detail).not.toContain('acme/private-api')
  })

  it('hides the error text of an unpublished run', () => {
    // #given a failed read of a private repository
    const shown = publicRun({ ...run, action: 'observe', error: 'Could not read acme/private-api from GitHub: 404' })

    // #then the public learns only that something needs attention
    expect(shown.error).toBe('Something needs the team')
  })

  it('shows posted work as it is', () => {
    // #given a run about a work package the team published
    const posted = { ...run, taskId: 'task_1', detail: '0.50 USDC paid to @alice on WORK-001' }

    // #then nothing is hidden
    expect(publicRun(posted)).toEqual(posted)
  })
})
