'use client'

import { LogOut, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { WorkflowSetup } from '@/server/github/workflow-setup'
import { Roll } from './roll'

export async function postJson(url: string, body: unknown = {}, method = 'POST'): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : `Request failed (${res.status})`)
  return data
}

/** Shared busy/error handling for console buttons and forms. */
export function useAction() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(fn: () => Promise<unknown>, after?: (result: unknown) => void) {
    setBusy(true)
    setError(null)
    try {
      const result = await fn()
      if (after) after(result)
      else router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, router }
}

const SIGN_IN_ERRORS: Record<string, string> = {
  not_owner: 'isn\'t on a team yet. Install bon travail on a repository your team owns (a GitHub admin can), then sign in again. Questions? Write to hello@bontravail.xyz.',
  state: 'The sign-in link expired. Try again.',
  denied: 'GitHub sign-in was cancelled.',
  github: 'GitHub did not confirm the sign-in. Try again.',
  github_not_configured: 'Sign in with GitHub is not set up in this deployment yet.',
}

export function OwnerLogin({
  error,
  login,
  enabled,
  installUrl,
}: {
  error: string | null
  login: string | null
  enabled: boolean
  installUrl: string | null
}) {
  const message = error ? SIGN_IN_ERRORS[error] ?? 'Sign-in failed. Try again.' : null
  return (
    <div className="console-login-wrap">
      <div className="panel console-login">
        <span className="label">For teams</span>
        <h1>Sign in to decide what leaves the team.</h1>
        <p className="muted">
          Connect your repositories, read what our agent found, and choose what to hand out and to whom. This is only for the team
          that owns the code.
        </p>
        {enabled ? (
          <a className="btn btn-primary btn-wide" href="/api/auth/github/start">
            <Roll><GithubMark /> Sign in with GitHub</Roll>
          </a>
        ) : (
          <p className="notice-line">Sign in with GitHub is not set up in this deployment yet.</p>
        )}
        {message && (
          <p className="form-error">
            {error === 'not_owner' && login ? `@${login} ` : ''}
            {message}
          </p>
        )}
        {error === 'not_owner' && installUrl && (
          <a className="action-pill" href={installUrl}>
            Install bon travail on GitHub
          </a>
        )}
      </div>

      <div className="panel console-humans">
        <span className="label">For humans</span>
        <h2>Here to fix code and get paid? No account needed.</h2>
        <p className="muted">Paid fixes show up on the work page. You claim one by opening a pull request, and you are paid when it works.</p>
        <Link className="btn btn-glass btn-wide" href="/tasks">
          <Roll>Find paid work</Roll>
        </Link>
      </div>
    </div>
  )
}

/** GitHub's mark, inline so no icon dependency is needed for one brand glyph. */
export function GithubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

/**
 * Picks one of the repositories the app is installed on and starts watching
 * it. Asks which workflow when the repository has several.
 */
function SetupNote({ slug, setup }: { slug: string; setup: WorkflowSetup }) {
  if (setup.kind === 'enable') {
    return (
      <div className="watch-setup">
        <p>
          {slug} is a fork, and GitHub keeps a fork&apos;s workflows off until you turn them on. Turn them on in its
          Actions tab, then come back and click Watch.
        </p>
        <a className="action-pill" href={setup.actionsUrl} target="_blank" rel="noreferrer">
          Open the Actions tab
        </a>
      </div>
    )
  }
  return (
    <div className="watch-setup">
      <p>
        {slug} has no GitHub Actions yet, so there is nothing to watch. We filled in a test workflow for it ({setup.label}).
        {setup.stack === 'unknown' && ' We could not tell how your tests run, so change the last line before you commit.'}{' '}
        Commit it on GitHub, then come back and click Watch.
      </p>
      <a className="action-pill" href={setup.url} target="_blank" rel="noreferrer">
        Add a test workflow on GitHub
      </a>
    </div>
  )
}

export function WatchPicker({ repos }: { repos: { slug: string; private: boolean }[] }) {
  const { busy, error, run } = useAction()
  const [slug, setSlug] = useState('')
  const [choices, setChoices] = useState<{ name: string; path: string }[] | null>(null)
  const [workflow, setWorkflow] = useState('')
  const [setup, setSetup] = useState<WorkflowSetup | null>(null)
  const known = repos.some((r) => r.slug.toLowerCase() === slug.trim().toLowerCase())

  function reset(next: string) {
    setSlug(next)
    setChoices(null)
    setSetup(null)
  }

  async function start() {
    const repo = slug.trim()
    await run(
      async () => {
        const res = await fetch(`/api/owner/repos/workflows?repo=${encodeURIComponent(repo)}`)
        const data = (await res.json()) as {
          workflows?: { name: string; path: string }[]
          setup?: WorkflowSetup
          message?: string
        }
        if (!res.ok || !data.workflows) throw new Error(data.message ?? 'Could not read workflows')
        setSetup(data.setup ?? null)
        if (data.workflows.length === 0) return undefined
        if (data.workflows.length === 1) return postJson('/api/owner/repos', { repo, workflow: data.workflows[0]!.path })
        setChoices(data.workflows)
        setWorkflow(data.workflows[0]!.path)
        return undefined
      },
      (result) => {
        if (result !== undefined) window.location.reload()
      },
    )
  }

  return (
    <div className="watch-picker">
      <div className="field">
        <label htmlFor="watch-repo">Watch a repository ({repos.length} installed)</label>
        <input
          id="watch-repo"
          className="input mono"
          list="installed-repos"
          placeholder="Start typing a repository name"
          autoComplete="off"
          spellCheck={false}
          value={slug}
          onChange={(e) => reset(e.target.value)}
        />
        <datalist id="installed-repos">
          {repos.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.private ? 'private' : 'public'}
            </option>
          ))}
        </datalist>
      </div>
      {choices && (
        <div className="field">
          <label htmlFor="watch-workflow">Workflow</label>
          <select id="watch-workflow" className="input" value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
            {choices.map((w) => (
              <option key={w.path} value={w.path}>
                {w.name} ({w.path})
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !known}
        onClick={() =>
          void (choices
            ? run(() => postJson('/api/owner/repos', { repo: slug.trim(), workflow }), () => window.location.reload())
            : start())
        }
      >
        <Roll>{busy ? 'Reading GitHub...' : 'Watch'}</Roll>
      </button>
      {setup && <SetupNote slug={slug.trim()} setup={setup} />}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

export function SignOut() {
  const { busy, run, router } = useAction()
  return (
    <button
      type="button"
      className="action-pill"
      disabled={busy}
      onClick={() => void run(() => postJson('/api/owner/session', {}, 'DELETE'), () => router.push('/'))}
    >
      <LogOut size={13} /> Sign out
    </button>
  )
}

export function ConnectRepo() {
  const { busy, error, run, router } = useAction()
  const [repo, setRepo] = useState('')
  const [workflow, setWorkflow] = useState('')
  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void run(
      () => postJson('/api/owner/repos', { repo: repo.trim(), ...(workflow.trim() ? { workflow: workflow.trim() } : {}) }),
      () => {
        setRepo('')
        setWorkflow('')
        router.refresh()
      },
    )
  }
  return (
    <form className="connect" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="repo">Repository</label>
        <input id="repo" className="input mono" placeholder="owner/name" value={repo} onChange={(e) => setRepo(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="workflow">Workflow (optional)</label>
        <input
          id="workflow"
          className="input mono"
          placeholder=".github/workflows/ci.yml"
          value={workflow}
          onChange={(e) => setWorkflow(e.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy || !repo.includes('/')}>
        <Roll>{busy ? 'Reading GitHub...' : 'Connect'}</Roll>
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  )
}

export function CheckNow({ repoId }: { repoId: string }) {
  const { busy, error, run } = useAction()
  return (
    <span className="check-now">
      <button type="button" className="action-pill" disabled={busy} onClick={() => void run(() => postJson('/api/owner/repos/poll', { repoId }))}>
        <RefreshCw size={13} className={busy ? 'spin' : undefined} /> {busy ? 'Checking' : 'Check now'}
      </button>
      {error && <small className="form-error">{error}</small>}
    </span>
  )
}

export function ActionButton({
  url,
  children,
  className = 'btn btn-glass',
  confirmText,
}: {
  url: string
  children: ReactNode
  className?: string
  confirmText?: string
}) {
  const { busy, error, run } = useAction()
  const [confirming, setConfirming] = useState(false)
  if (confirmText && confirming) {
    return (
      <span className="confirm">
        <span>{confirmText}</span>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => postJson(url))}>
          <Roll>Yes</Roll>
        </button>
        <button type="button" className="btn btn-glass" disabled={busy} onClick={() => setConfirming(false)}>
          <Roll>Cancel</Roll>
        </button>
        {error && <small className="form-error">{error}</small>}
      </span>
    )
  }
  return (
    <span>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => (confirmText ? setConfirming(true) : void run(() => postJson(url)))}
      >
        {children}
      </button>
      {error && <small className="form-error">{error}</small>}
    </span>
  )
}

/** Operators set how much USDC a team may hold in escrow at once. */
export function TeamBudget({ team, budget }: { team: string; budget: string }) {
  const { busy, error, run } = useAction()
  const [value, setValue] = useState(budget)
  return (
    <span className="check-now">
      <span className="team-budget">
        <input
          className="input mono"
          aria-label={`Budget for ${team} in USDC`}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className="action-pill"
          disabled={busy || value.trim() === budget}
          onClick={() => void run(() => postJson('/api/owner/teams/budget', { team, budget: value.trim() }))}
        >
          {busy ? 'Saving' : 'Set budget'}
        </button>
      </span>
      {error && <small className="form-error">{error}</small>}
    </span>
  )
}
