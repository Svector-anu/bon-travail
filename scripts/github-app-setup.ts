import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

/**
 * Creates the Bon Travail GitHub App from a manifest, so nobody copies keys by
 * hand. Run it, press "Create GitHub App" on the page GitHub shows, and the
 * app's credentials are written to .env.local (never printed).
 *
 *   npm run github:app -- --base https://bon-travail.vercel.app [--org my-org] [--name "Bon Travail"]
 *
 * Read-only by design: Actions, checks, contents, pull requests and metadata,
 * all read. No webhooks: the agent tick polls.
 */
const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
const base = (args.get('base') ?? '').replace(/\/$/, '')
if (!/^https:\/\//.test(base)) throw new Error('Pass --base https://your-deployment')
const org = args.get('org')
const name = args.get('name') ?? 'Bon Travail'
const port = 4567
const state = randomBytes(16).toString('hex')

const manifest = {
  name,
  url: base,
  description: 'Watches the CI of repositories you choose, so recurring failures can be fixed by people you approve and paid when the tests pass.',
  redirect_url: `http://localhost:${port}/callback`,
  callback_urls: [`${base}/api/auth/github/callback`, 'http://localhost:3000/api/auth/github/callback'],
  setup_url: `${base}/console/github/setup`,
  setup_on_update: true,
  public: true,
  hook_attributes: { url: `${base}/api/github/webhook`, active: false },
  default_permissions: { actions: 'read', checks: 'read', contents: 'read', pull_requests: 'read', metadata: 'read' },
  default_events: [],
  request_oauth_on_install: false,
}

function setEnv(values: Record<string, string>): void {
  let env = ''
  try {
    env = readFileSync('.env.local', 'utf8')
  } catch {
    env = ''
  }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`
    env = new RegExp(`^${key}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${env.replace(/\n?$/, '\n')}${line}\n`
  }
  writeFileSync('.env.local', env, { mode: 0o600 })
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  if (url.pathname === '/') {
    const target = org
      ? `https://github.com/organizations/${org}/settings/apps/new?state=${state}`
      : `https://github.com/settings/apps/new?state=${state}`
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><meta charset="utf-8"><title>Create the GitHub App</title>
<form id="f" method="post" action="${target}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"></form>
<p>Opening GitHub…</p><script>document.getElementById('f').submit()</script>`)
    return
  }
  if (url.pathname === '/callback') {
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400).end('State mismatch; run the script again.')
      return
    }
    const code = url.searchParams.get('code') ?? ''
    const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'bon-travail-setup' },
    })
    const app = (await response.json()) as { id?: number; slug?: string; client_id?: string; client_secret?: string; pem?: string; html_url?: string }
    if (!response.ok || !app.id || !app.pem || !app.slug || !app.client_id || !app.client_secret) {
      res.writeHead(500).end(`GitHub did not return the app (${response.status}).`)
      console.error(`conversion failed: ${response.status}`)
      server.close()
      return
    }
    setEnv({
      GITHUB_APP_ID: String(app.id),
      GITHUB_APP_SLUG: app.slug,
      GITHUB_APP_CLIENT_ID: app.client_id,
      GITHUB_APP_CLIENT_SECRET: app.client_secret,
      GITHUB_APP_PRIVATE_KEY: Buffer.from(app.pem).toString('base64'),
    })
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><meta charset="utf-8"><title>GitHub App created</title>
<p>Created <strong>${escapeHtml(app.slug)}</strong>. Its credentials are in .env.local.</p>
<p>Next: <a href="https://github.com/apps/${escapeHtml(app.slug)}/installations/new">install it on the repositories to watch</a>.</p>`)
    console.log(`GITHUB_APP_CREATED ${app.slug} (id ${app.id}); credentials written to .env.local`)
    server.close()
  }
})

server.listen(port, () => console.log(`Open http://localhost:${port} and press "Create GitHub App" on GitHub.`))
