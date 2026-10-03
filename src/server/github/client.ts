/** GitHub could not answer right now (network, 5xx, rate limit). Safe to retry. */
export class GitHubUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GitHubUnavailableError'
  }
}

/** The repository, workflow, run or PR does not exist (or the token cannot see it). */
export class GitHubNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubNotFoundError'
  }
}

export interface GhRepo {
  owner: string
  name: string
  defaultBranch: string
  private: boolean
  htmlUrl: string
}

export interface GhWorkflow {
  id: number
  name: string
  path: string
  state: string
}

export interface GhRun {
  id: number
  runNumber: number
  runAttempt: number
  headSha: string
  headBranch: string
  event: string
  status: string
  conclusion: string | null
  htmlUrl: string
  createdAt: number
  path: string
}

export interface GhStep {
  name: string
  number: number
  conclusion: string | null
}

export interface GhJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  htmlUrl: string
  steps: GhStep[]
}

export interface GhCommit {
  sha: string
  message: string
  author: string | null
  url: string
}

export interface GhCompare {
  htmlUrl: string
  commits: GhCommit[]
  files: string[]
  totalCommits: number
}

export interface GhPull {
  number: number
  htmlUrl: string
  state: 'open' | 'closed'
  draft: boolean
  merged: boolean
  mergeSha: string | null
  headSha: string
  baseRef: string
  baseRepo: string
  author: string
  title: string
  body: string
}

export interface RunQuery {
  branch?: string
  headSha?: string
  event?: string
  status?: 'completed'
  perPage?: number
}

/** The slice of the GitHub REST API Proofwork reads. Read-only by design. */
export interface GitHubClient {
  getRepo(owner: string, name: string): Promise<GhRepo>
  listWorkflows(owner: string, name: string): Promise<GhWorkflow[]>
  listRuns(owner: string, name: string, workflow: string | number, query: RunQuery): Promise<GhRun[]>
  listJobs(owner: string, name: string, runId: number): Promise<GhJob[]>
  jobLog(owner: string, name: string, jobId: number): Promise<string>
  fileAt(owner: string, name: string, path: string, ref: string): Promise<string | null>
  compare(owner: string, name: string, base: string, head: string): Promise<GhCompare>
  getPull(owner: string, name: string, number: number): Promise<GhPull>
  listPullFiles(owner: string, name: string, number: number): Promise<string[]>
}

type Json = Record<string, unknown>

function s(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function n(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function obj(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {}
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(obj) : []
}

function toRun(run: Json): GhRun {
  return {
    id: n(run.id),
    runNumber: n(run.run_number),
    runAttempt: n(run.run_attempt ?? 1),
    headSha: s(run.head_sha),
    headBranch: s(run.head_branch),
    event: s(run.event),
    status: s(run.status),
    conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
    htmlUrl: s(run.html_url),
    createdAt: Date.parse(s(run.created_at)),
    path: s(run.path),
  }
}

const API = 'https://api.github.com'

/** Anything that can hand out a token able to read one repository. */
export interface RepoTokenSource {
  forRepo(owner: string, name: string): Promise<string>
}

export class RestGitHubClient implements GitHubClient {
  constructor(
    private readonly tokens: RepoTokenSource,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(owner: string, name: string, path: string, init: { accept?: string } = {}): Promise<Response> {
    const token = await this.tokens.forRepo(owner, name)
    let response: Response
    try {
      response = await this.fetchImpl(`${API}${path}`, {
        headers: {
          accept: init.accept ?? 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'proofwork',
          'x-github-api-version': '2022-11-28',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new GitHubUnavailableError(`GitHub request failed: ${path}`, { cause: error })
    }
    if (response.status === 404 || response.status === 410) throw new GitHubNotFoundError(`GitHub has no ${path}`)
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new GitHubUnavailableError('GitHub rate limit reached')
    }
    if (!response.ok) throw new GitHubUnavailableError(`GitHub ${response.status} for ${path}`)
    return response
  }

  private async json(owner: string, name: string, path: string): Promise<Json> {
    return obj(await (await this.request(owner, name, path)).json())
  }

  async getRepo(owner: string, name: string): Promise<GhRepo> {
    const repo = await this.json(owner, name, `/repos/${owner}/${name}`)
    return {
      owner: s(obj(repo.owner).login, owner),
      name: s(repo.name, name),
      defaultBranch: s(repo.default_branch, 'main'),
      private: repo.private === true,
      htmlUrl: s(repo.html_url),
    }
  }

  async listWorkflows(owner: string, name: string): Promise<GhWorkflow[]> {
    const body = await this.json(owner, name, `/repos/${owner}/${name}/actions/workflows?per_page=100`)
    return list(body.workflows).map((w) => ({ id: n(w.id), name: s(w.name), path: s(w.path), state: s(w.state) }))
  }

  async listRuns(owner: string, name: string, workflow: string | number, query: RunQuery): Promise<GhRun[]> {
    const params = new URLSearchParams({ per_page: String(query.perPage ?? 30) })
    if (query.branch) params.set('branch', query.branch)
    if (query.headSha) params.set('head_sha', query.headSha)
    if (query.event) params.set('event', query.event)
    if (query.status) params.set('status', query.status)
    const body = await this.json(
      owner,
      name,
      `/repos/${owner}/${name}/actions/workflows/${encodeURIComponent(String(workflow))}/runs?${params}`,
    )
    return list(body.workflow_runs).map(toRun)
  }

  async listJobs(owner: string, name: string, runId: number): Promise<GhJob[]> {
    const body = await this.json(owner, name, `/repos/${owner}/${name}/actions/runs/${runId}/jobs?filter=latest&per_page=100`)
    return list(body.jobs).map((job) => ({
      id: n(job.id),
      name: s(job.name),
      status: s(job.status),
      conclusion: typeof job.conclusion === 'string' ? job.conclusion : null,
      htmlUrl: s(job.html_url),
      steps: list(job.steps).map((step) => ({
        name: s(step.name),
        number: n(step.number),
        conclusion: typeof step.conclusion === 'string' ? step.conclusion : null,
      })),
    }))
  }

  async jobLog(owner: string, name: string, jobId: number): Promise<string> {
    const response = await this.request(owner, name, `/repos/${owner}/${name}/actions/jobs/${jobId}/logs`)
    return response.text()
  }

  async fileAt(owner: string, name: string, path: string, ref: string): Promise<string | null> {
    try {
      const response = await this.request(
        owner,
        name,
        `/repos/${owner}/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
        { accept: 'application/vnd.github.raw+json' },
      )
      return await response.text()
    } catch (error) {
      if (error instanceof GitHubNotFoundError) return null
      throw error
    }
  }

  async compare(owner: string, name: string, base: string, head: string): Promise<GhCompare> {
    const body = await this.json(owner, name, `/repos/${owner}/${name}/compare/${base}...${head}`)
    return {
      htmlUrl: s(body.html_url),
      totalCommits: n(body.total_commits),
      commits: list(body.commits).map((c) => {
        const commit = obj(c.commit)
        return {
          sha: s(c.sha),
          message: s(commit.message).split('\n')[0] ?? '',
          author: s(obj(c.author).login) || s(obj(commit.author).name) || null,
          url: s(c.html_url),
        }
      }),
      files: list(body.files).map((f) => s(f.filename)),
    }
  }

  async getPull(owner: string, name: string, number: number): Promise<GhPull> {
    const pr = await this.json(owner, name, `/repos/${owner}/${name}/pulls/${number}`)
    const base = obj(pr.base)
    return {
      number: n(pr.number),
      htmlUrl: s(pr.html_url),
      state: pr.state === 'closed' ? 'closed' : 'open',
      draft: pr.draft === true,
      merged: pr.merged === true,
      mergeSha: pr.merged === true ? s(pr.merge_commit_sha) || null : null,
      headSha: s(obj(pr.head).sha),
      baseRef: s(base.ref),
      baseRepo: s(obj(base.repo).full_name),
      author: s(obj(pr.user).login),
      title: s(pr.title),
      body: s(pr.body),
    }
  }

  async listPullFiles(owner: string, name: string, number: number): Promise<string[]> {
    const files: string[] = []
    for (let page = 1; page <= 30; page++) {
      const response = await this.request(owner, name, `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`)
      const batch = list(await response.json())
      for (const file of batch) {
        files.push(s(file.filename))
        if (typeof file.previous_filename === 'string') files.push(file.previous_filename)
      }
      if (batch.length < 100) break
    }
    return files
  }
}

/** Parses https://github.com/owner/repo/pull/123 (with optional trailing path). */
export function parsePullUrl(input: string): { owner: string; name: string; number: number } | null {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(input.trim())
  if (!match) return null
  return { owner: match[1]!, name: match[2]!, number: Number(match[3]) }
}

export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
export const REPO_SLUG = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/
