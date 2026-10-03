import { createPrivateKey, createSign } from 'node:crypto'
import { GitHubNotFoundError, GitHubUnavailableError, type RepoTokenSource } from './client'

const API = 'https://api.github.com'

export interface GitHubAppCredentials {
  appId: string
  privateKey: string
  slug: string
}

export interface InstallationRepo {
  owner: string
  name: string
  private: boolean
  installationId: number
}

/** One fixed token for every repository (local development, or a single read-only PAT). */
export class StaticTokenSource implements RepoTokenSource {
  constructor(private readonly token: string) {}

  async forRepo(): Promise<string> {
    return this.token
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/** Private keys arrive from env vars as PEM, PEM with escaped newlines, or base64 of PEM. */
export function normalizePem(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.includes('BEGIN')) return trimmed.replace(/\\n/g, '\n')
  return Buffer.from(trimmed, 'base64').toString('utf8')
}

/** A GitHub App JWT: RS256, valid ten minutes, backdated a minute for clock drift. */
export function appJwt(appId: string, privateKeyPem: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  const signature = signer.sign(createPrivateKey(privateKeyPem)).toString('base64url')
  return `${header}.${payload}.${signature}`
}

/**
 * Reads repositories through the Bon Travail GitHub App. Each repository is
 * read with a short-lived installation token for the installation that covers
 * it, so access is exactly what the team granted when installing the app.
 */
export class GitHubApp implements RepoTokenSource {
  private readonly pem: string
  private readonly tokens = new Map<number, { token: string; expiresAt: number }>()
  private readonly repoInstallations = new Map<string, number>()

  constructor(
    private readonly credentials: GitHubAppCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.pem = normalizePem(credentials.privateKey)
  }

  get slug(): string {
    return this.credentials.slug
  }

  get installUrl(): string {
    return `https://github.com/apps/${this.credentials.slug}/installations/new`
  }

  private async call(path: string, init: { method?: string; auth: string }): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await this.fetchImpl(`${API}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${init.auth}`,
          'user-agent': 'bon-travail',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new GitHubUnavailableError(`GitHub request failed: ${path}`, { cause: error })
    }
    if (response.status === 404) throw new GitHubNotFoundError(`GitHub has no ${path}`)
    if (!response.ok) throw new GitHubUnavailableError(`GitHub ${response.status} for ${path}`)
    return (await response.json()) as Record<string, unknown>
  }

  private jwt(): string {
    return appJwt(this.credentials.appId, this.pem, this.now())
  }

  async installationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId)
    if (cached && cached.expiresAt - this.now() > 5 * 60 * 1000) return cached.token
    const body = await this.call(`/app/installations/${installationId}/access_tokens`, { method: 'POST', auth: this.jwt() })
    const token = String(body.token)
    this.tokens.set(installationId, { token, expiresAt: Date.parse(String(body.expires_at)) })
    return token
  }

  /** Which installation covers a repository; throws NotFound when the app is not installed there. */
  async installationFor(owner: string, name: string): Promise<number> {
    const key = `${owner}/${name}`.toLowerCase()
    const cached = this.repoInstallations.get(key)
    if (cached) return cached
    const body = await this.call(`/repos/${owner}/${name}/installation`, { auth: this.jwt() })
    const id = Number(body.id)
    this.repoInstallations.set(key, id)
    return id
  }

  async forRepo(owner: string, name: string): Promise<string> {
    return this.installationToken(await this.installationFor(owner, name))
  }

  /** Confirms an installation belongs to this app before trusting an id from a redirect. */
  async getInstallation(installationId: number): Promise<{ id: number; account: string }> {
    const body = await this.call(`/app/installations/${installationId}`, { auth: this.jwt() })
    return { id: Number(body.id), account: String((body.account as { login?: string } | null)?.login ?? '') }
  }

  /** Every repository any installation of the app can read. */
  async listRepos(): Promise<InstallationRepo[]> {
    const installations = (await this.callList('/app/installations?per_page=100', this.jwt())) as { id: number }[]
    const repos: InstallationRepo[] = []
    for (const installation of installations) {
      const token = await this.installationToken(installation.id)
      for (let page = 1; page <= 10; page++) {
        const body = await this.call(`/installation/repositories?per_page=100&page=${page}`, { auth: token })
        const batch = (body.repositories as { name: string; private: boolean; owner: { login: string } }[]) ?? []
        for (const repo of batch) {
          repos.push({ owner: repo.owner.login, name: repo.name, private: repo.private, installationId: installation.id })
          this.repoInstallations.set(`${repo.owner.login}/${repo.name}`.toLowerCase(), installation.id)
        }
        if (batch.length < 100) break
      }
    }
    return repos.sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`))
  }

  private async callList(path: string, auth: string): Promise<unknown[]> {
    let response: Response
    try {
      response = await this.fetchImpl(`${API}${path}`, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${auth}`, 'user-agent': 'bon-travail' },
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new GitHubUnavailableError(`GitHub request failed: ${path}`, { cause: error })
    }
    if (!response.ok) throw new GitHubUnavailableError(`GitHub ${response.status} for ${path}`)
    const body = (await response.json()) as unknown
    return Array.isArray(body) ? body : []
  }
}
