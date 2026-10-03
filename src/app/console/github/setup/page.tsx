import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Reveal } from '@/components/reveal'
import { getApp } from '@/server/container'
import { isOwnerSession } from '@/server/owner-session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'GitHub connected' }

/**
 * Where GitHub sends the engineer after installing the app. The installation
 * id in the URL is only a hint: it is looked up with the app's own credentials
 * before anything is shown, and nothing is stored from it.
 */
export default async function GitHubSetupPage({ searchParams }: { searchParams: Promise<{ installation_id?: string }> }) {
  if (!(await isOwnerSession())) redirect('/console')
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
            ? 'Choose which repositories to watch. Bon Travail only reads them; it never pushes, comments or merges.'
            : 'Try installing the app again from the console.'}
        </p>
        <Link className="btn btn-primary btn-wide" href="/console">
          Back to the console
        </Link>
      </div>
    </Reveal>
  )
}
