import {
  GitHubNotFoundError,
  GitHubUnavailableError,
  type GhCompare,
  type GhJob,
  type GhPull,
  type GhRepo,
  type GhRun,
  type GhWorkflow,
  type GitHubClient,
  type RunQuery,
} from '@/server/github/client'

export const OWNER = 'acme'
export const NAME = 'sdk-examples'
export const WORKFLOW_PATH = '.github/workflows/examples.yml'
export const WORKFLOW_ID = 4242
export const JOB = 'examples'
export const STEP = 'Run examples'

export const WORKFLOW_YAML = `name: Examples
on: [push, pull_request]
jobs:
  examples:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run examples
        run: npm test
`

export const FAILING_LOG = [
  '2026-10-02T09:00:01.0000000Z ##[group]Run npm test',
  '2026-10-02T09:00:02.0000000Z > node examples/transfer.mjs',
  '2026-10-02T09:00:02.1000000Z AssertionError: expected 1.5 USDC, got 1500000',
  '2026-10-02T09:00:02.2000000Z ##[error]Process completed with exit code 1.',
].join('\n')

let nextId = 1000

/** An in-memory GitHub that answers the same read-only questions the real client asks. */
export class FakeGitHub implements GitHubClient {
  down = false
  runs: GhRun[] = []
  jobs = new Map<number, GhJob[]>()
  logs = new Map<number, string>()
  pulls = new Map<number, GhPull>()
  pullFiles = new Map<number, string[]>()
  compareCommits: GhCompare['commits'] = []
  fork = false
  /** Extra files at the repository root, by path. */
  files: Record<string, string> = {}
  workflows: GhWorkflow[] = [{ id: WORKFLOW_ID, name: 'Examples', path: WORKFLOW_PATH, state: 'active' }]

  private check() {
    if (this.down) throw new GitHubUnavailableError('github down')
  }

  /** Adds a completed (or running) workflow run; failing runs fail at JOB/STEP unless told otherwise. */
  addRun(input: {
    sha: string
    at: number
    conclusion: 'success' | 'failure' | null
    event?: string
    branch?: string
    status?: string
    failing?: { job: string; step: string }
  }): GhRun {
    const run: GhRun = {
      id: nextId++,
      runNumber: this.runs.length + 1,
      runAttempt: 1,
      headSha: input.sha,
      headBranch: input.branch ?? 'main',
      event: input.event ?? 'push',
      status: input.status ?? 'completed',
      conclusion: input.conclusion,
      htmlUrl: `https://github.com/${OWNER}/${NAME}/actions/runs/${nextId}`,
      createdAt: input.at,
      path: WORKFLOW_PATH,
    }
    this.runs.push(run)
    const jobId = nextId++
    const failing = input.failing ?? { job: JOB, step: STEP }
    const failed = input.conclusion === 'failure'
    this.jobs.set(run.id, [
      {
        id: jobId,
        name: failed ? failing.job : JOB,
        status: run.status,
        conclusion: input.conclusion,
        htmlUrl: `${run.htmlUrl}/job/${jobId}`,
        steps: [
          { name: 'Set up job', number: 1, conclusion: 'success' },
          { name: failed ? failing.step : STEP, number: 2, conclusion: input.conclusion },
        ],
      },
    ])
    if (failed) this.logs.set(jobId, FAILING_LOG)
    return run
  }

  addPull(pull: Partial<GhPull> & { number: number; author: string }, files: string[] = ['src/transfer.ts']): GhPull {
    const full: GhPull = {
      htmlUrl: `https://github.com/${OWNER}/${NAME}/pull/${pull.number}`,
      state: 'open',
      draft: false,
      merged: false,
      mergeSha: null,
      headSha: `head${pull.number}`.padEnd(40, '0'),
      baseRef: 'main',
      baseRepo: `${OWNER}/${NAME}`,
      title: 'Fix transfer amount formatting',
      body: '',
      ...pull,
    }
    this.pulls.set(pull.number, full)
    this.pullFiles.set(pull.number, files)
    return full
  }

  merge(number: number, mergeSha: string): void {
    const pull = this.pulls.get(number)!
    this.pulls.set(number, { ...pull, state: 'closed', merged: true, mergeSha })
  }

  async getRepo(owner: string, name: string): Promise<GhRepo> {
    this.check()
    if (owner !== OWNER || name !== NAME) throw new GitHubNotFoundError(`${owner}/${name}`)
    return { owner, name, defaultBranch: 'main', private: false, fork: this.fork, htmlUrl: `https://github.com/${owner}/${name}` }
  }

  async listWorkflows(): Promise<GhWorkflow[]> {
    this.check()
    return this.workflows
  }

  async listRuns(_owner: string, _name: string, workflow: string | number, query: RunQuery): Promise<GhRun[]> {
    this.check()
    if (workflow !== WORKFLOW_ID && workflow !== 'examples.yml') return []
    return this.runs
      .filter((r) => (query.branch ? r.headBranch === query.branch : true))
      .filter((r) => (query.headSha ? r.headSha === query.headSha : true))
      .filter((r) => (query.event ? r.event === query.event : true))
      .filter((r) => (query.status ? r.status === query.status : true))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, query.perPage ?? 30)
  }

  async listJobs(_owner: string, _name: string, runId: number): Promise<GhJob[]> {
    this.check()
    return this.jobs.get(runId) ?? []
  }

  async jobLog(_owner: string, _name: string, jobId: number): Promise<string> {
    this.check()
    const log = this.logs.get(jobId)
    if (!log) throw new GitHubNotFoundError(`log ${jobId}`)
    return log
  }

  async fileAt(_owner: string, _name: string, path: string): Promise<string | null> {
    this.check()
    if (path === WORKFLOW_PATH) return WORKFLOW_YAML
    return this.files[path] ?? null
  }

  async listPaths(): Promise<string[]> {
    this.check()
    return [WORKFLOW_PATH, ...Object.keys(this.files)]
  }

  async compare(_owner: string, _name: string, base: string, head: string): Promise<GhCompare> {
    this.check()
    return {
      htmlUrl: `https://github.com/${OWNER}/${NAME}/compare/${base}...${head}`,
      commits: this.compareCommits,
      files: ['src/transfer.ts'],
      totalCommits: this.compareCommits.length,
    }
  }

  async getPull(_owner: string, _name: string, number: number): Promise<GhPull> {
    this.check()
    const pull = this.pulls.get(number)
    if (!pull) throw new GitHubNotFoundError(`pull ${number}`)
    return pull
  }

  async listPullFiles(_owner: string, _name: string, number: number): Promise<string[]> {
    this.check()
    return this.pullFiles.get(number) ?? []
  }
}

export const sha = (label: string) => label.padEnd(40, '0')
