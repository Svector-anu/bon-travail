import { describe, expect, it } from 'vitest'
import { detectStack, workflowSetup, workflowYaml } from '@/server/github/workflow-setup'
import { FakeGitHub, NAME, OWNER } from './fake-github'

function repoWith(files: Record<string, string>, fork = false): FakeGitHub {
  const gh = new FakeGitHub()
  gh.files = files
  gh.fork = fork
  return gh
}

describe('workflow setup for a repository with no GitHub Actions', () => {
  it('picks the package manager from the lockfile', async () => {
    const pkg = JSON.stringify({ scripts: { test: 'vitest run' } })
    expect((await detectStack(repoWith({ 'package.json': pkg, 'pnpm-lock.yaml': '' }), 'o', 'r', 'main')).test).toBe('pnpm test')
    expect((await detectStack(repoWith({ 'package.json': pkg, 'yarn.lock': '' }), 'o', 'r', 'main')).test).toBe('yarn test')
    const npm = await detectStack(repoWith({ 'package.json': pkg, 'package-lock.json': '{}' }), 'o', 'r', 'main')
    expect(npm.label).toBe('Node, npm test')
    expect(npm.setup.join('\n')).toContain('npm ci')
  })

  it('tells the team when package.json has no test script', async () => {
    const detected = await detectStack(repoWith({ 'package.json': '{}' }), 'o', 'r', 'main')
    expect(detected.label).toContain('add a "test" script')
  })

  it('reads a Solana program as Anchor before anything else', async () => {
    const detected = await detectStack(repoWith({ 'Anchor.toml': '', 'package.json': '{}', 'Cargo.toml': '' }), 'o', 'r', 'main')
    expect(detected.stack).toBe('anchor')
  })

  it('knows Go, Rust and Python', async () => {
    expect((await detectStack(repoWith({ 'go.mod': '' }), 'o', 'r', 'main')).stack).toBe('go')
    expect((await detectStack(repoWith({ 'Cargo.toml': '' }), 'o', 'r', 'main')).stack).toBe('rust')
    const python = await detectStack(repoWith({ 'requirements.txt': '' }), 'o', 'r', 'main')
    expect(python.setup.join('\n')).toContain('pip install -r requirements.txt pytest')
  })

  it('finds a project one folder down and runs it there', async () => {
    const gh = repoWith({ 'README.md': '', 'abokisolana/package.json': JSON.stringify({ scripts: { test: 'jest' } }) })
    const detected = await detectStack(gh, 'o', 'r', 'main')
    expect(detected).toMatchObject({ stack: 'node', dir: 'abokisolana', test: 'npm test' })
    expect(workflowYaml(detected, 'main')).toContain('    defaults:\n      run:\n        working-directory: abokisolana\n')
  })

  it('ignores manifests in vendored or example folders', async () => {
    const detected = await detectStack(repoWith({ 'node_modules/package.json': '{}', 'examples/go.mod': '' }), 'o', 'r', 'main')
    expect(detected.stack).toBe('unknown')
  })

  it('falls back to a starter that fails until the team edits it', async () => {
    const detected = await detectStack(repoWith({}), 'o', 'r', 'main')
    expect(detected.stack).toBe('unknown')
    expect(detected.test).toContain('exit 1')
  })

  it('writes one "test" job with a "Run tests" step on the default branch', async () => {
    const yaml = workflowYaml(await detectStack(repoWith({ 'go.mod': '' }), 'o', 'r', 'main'), 'trunk')
    expect(yaml).toContain('branches: [trunk]')
    expect(yaml).toMatch(/jobs:\n {2}test:\n/)
    expect(yaml).toContain('      - name: Run tests\n        run: go test ./...')
  })

  it("links to GitHub's new-file page with the workflow filled in", async () => {
    const setup = await workflowSetup(repoWith({ 'go.mod': '' }), OWNER, NAME)
    if (setup.kind !== 'add') throw new Error('expected a workflow to add')
    const url = new URL(setup.url)
    expect(url.pathname).toMatch(/\/new\/main$/)
    expect(url.searchParams.get('filename')).toBe('.github/workflows/ci.yml')
    expect(url.searchParams.get('value')).toBe(setup.yaml)
  })

  it('sends a fork to its Actions tab instead', async () => {
    const setup = await workflowSetup(repoWith({}, true), OWNER, NAME)
    expect(setup).toEqual({ kind: 'enable', actionsUrl: `https://github.com/${OWNER}/${NAME}/actions` })
  })
})
