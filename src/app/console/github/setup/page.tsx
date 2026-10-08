import type { Metadata } from 'next'
import Link from 'next/link'
import { Reveal } from '@/components/reveal'
import { getApp } from '@/server/container'
import { consoleViewer } from '@/server/owner-session'
import { Roll } from '@/components/roll'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'GitHub connected' }

/**
 * Where GitHub sends someone after installing the app. The installation id in
 * the URL is only a hint: it is looked up with the app's own credentials
 * before anything is shown, and nothing is stored from it. Team membership is
 * read from GitHub at sign-in, so a new install always goes through sign-in.
 */
export default async function GitHubSetupPage({ searchParams }: { searchParams: Promise<{ installation_id?: string }> }) {
  const viewer = await consoleViewer()
  const { githubApp } = await getApp()
  const id = Number((await searchParams).installation_id)
  let account: string | null = null
  if (githubApp && Number.isInteger(id) && id > 0) {
    account = await githubApp
      .getInstallation(id)
      .then((installation) => installation.account)
      .catch(() => null)
  }

  return (
    <Reveal>
      <div className="panel console-login">
        <span className="label">GitHub</span>
        <h1>{account ? `Connected to ${account}.` : 'GitHub did not confirm that installation.'}</h1>
        <p className="muted">
          {account
            ? 'Choose which repositories to watch. bon travail only reads them; it never pushes, comments or merges.'
            : 'Try installing the app again from the console.'}
        </p>
        {account ? (
          // Signing in again is what adds the new team: GitHub only reports it at sign-in.
          <a className="btn btn-primary btn-wide" href="/api/auth/github/start">
            <Roll>{viewer ? 'Continue to the console' : 'Sign in with GitHub to set it up'}</Roll>
          </a>
        ) : (
          <Link className="btn btn-primary btn-wide" href="/console">
            <Roll>Back to the console</Roll>
          </Link>
        )}
      </div>
    </Reveal>
  )
}
