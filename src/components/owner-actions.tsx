'use client'

import { LogOut, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'

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

export function OwnerLogin() {
  const { busy, error, run, router } = useAction()
  const [token, setToken] = useState('')
  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void run(() => postJson('/api/owner/session', { token: token.trim() }), () => router.refresh())
  }
  return (
    <form className="panel console-login" onSubmit={onSubmit}>
      <span className="label">Engineer console</span>
      <h1>Sign in to decide what leaves the team.</h1>
      <p className="muted">
        The console is where repositories are connected and findings are kept internal or externalized. Contributors never need an account; this is only for the team that owns the code.
      </p>
      <div className="field">
        <label htmlFor="owner-token">Access token</label>
        <input
          id="owner-token"
          className="input mono"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy || token.trim().length === 0}>
        {busy ? 'Checking...' : 'Sign in'}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  )
}

export function SignOut() {
  const { busy, run, router } = useAction()
  return (
    <button
      type="button"
      className="text-link"
      disabled={busy}
      onClick={() => void run(() => postJson('/api/owner/session', {}, 'DELETE'), () => router.push('/'))}
    >
      <LogOut size={13} /> Sign out
    </button>
  )
}

export function ConnectRepo() {
  const { busy, error, run } = useAction()
  const [repo, setRepo] = useState('')
  const [workflow, setWorkflow] = useState('')
  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void run(() => postJson('/api/owner/repos', { repo: repo.trim(), ...(workflow.trim() ? { workflow: workflow.trim() } : {}) }))
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
        {busy ? 'Reading GitHub...' : 'Connect'}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  )
}

export function CheckNow({ repoId }: { repoId: string }) {
  const { busy, error, run } = useAction()
  return (
    <span className="check-now">
      <button type="button" className="text-link" disabled={busy} onClick={() => void run(() => postJson('/api/owner/repos/poll', { repoId }))}>
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
          Yes
        </button>
        <button type="button" className="btn btn-glass" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
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
