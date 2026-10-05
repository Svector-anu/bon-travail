import type { GitHubClient } from './client'

export type Stack = 'node' | 'python' | 'go' | 'rust' | 'anchor' | 'unknown'

export interface DetectedStack {
  stack: Stack
  /** What a person reads: "Node (npm test)". */
  label: string
  /** The folder the project lives in, relative to the repository root; '' for the root. */
  dir: string
  /** Steps between checkout and the test step: toolchain setup and installs. */
  setup: string[]
  test: string
}

/** A repository with nothing to watch yet: either a fork whose workflows are switched off, or one that needs a workflow. */
export type WorkflowSetup =
  | { kind: 'enable'; actionsUrl: string }
  | { kind: 'add'; stack: Stack; label: string; yaml: string; url: string }

const WORKFLOW_FILE = '.github/workflows/ci.yml'

/** Manifests in the order they decide a folder's stack: an Anchor workspace also has Cargo.toml and package.json. */
const MANIFESTS = ['Anchor.toml', 'package.json', 'go.mod', 'Cargo.toml', 'requirements.txt', 'pyproject.toml', 'setup.py'] as const
type Manifest = (typeof MANIFESTS)[number]

const IGNORED_DIRS = new Set(['node_modules', 'vendor', 'target', 'dist', 'build', 'examples', 'docs'])

const SETUP_NODE = '- uses: actions/setup-node@v4\n        with:\n          node-version: 22'
const SETUP_RUST = '- uses: dtolnay/rust-toolchain@stable'

type Reader = Pick<GitHubClient, 'fileAt' | 'listPaths'>

function split(path: string): { dir: string; file: string } {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? { dir: '', file: path } : { dir: path.slice(0, slash), file: path.slice(slash + 1) }
}

/**
 * The project folder and its manifests: the root if it has one, otherwise the
 * first top-level folder that does. Deeper layouts get the editable starter.
 */
function projectFolder(paths: string[]): { dir: string; manifests: Set<string> } | null {
  const byDir = new Map<string, Set<string>>()
  for (const path of paths) {
    const { dir, file } = split(path)
    if (dir.includes('/') || IGNORED_DIRS.has(dir) || dir.startsWith('.')) continue
    const files = byDir.get(dir) ?? new Set<string>()
    files.add(file)
    byDir.set(dir, files)
  }
  const hasManifest = (files: Set<string>) => MANIFESTS.some((m) => files.has(m))
  const root = byDir.get('')
  if (root && hasManifest(root)) return { dir: '', manifests: root }
  const dir = [...byDir.keys()].filter((d) => d !== '' && hasManifest(byDir.get(d)!)).sort()[0]
  return dir === undefined ? null : { dir, manifests: byDir.get(dir)! }
}

function hasTestScript(pkg: string | null): boolean {
  if (pkg === null) return false
  try {
    const scripts = (JSON.parse(pkg) as { scripts?: Record<string, unknown> }).scripts
    return typeof scripts?.test === 'string'
  } catch {
    return false
  }
}

function nodeStack(dir: string, files: Set<string>, testScript: boolean): DetectedStack {
  const [manager, install] = files.has('pnpm-lock.yaml')
    ? ['pnpm', 'pnpm install --frozen-lockfile']
    : files.has('yarn.lock')
      ? ['yarn', 'yarn install --immutable']
      : ['npm', files.has('package-lock.json') ? 'npm ci' : 'npm install']
  const corepack = manager === 'npm' ? [] : ['- run: corepack enable']
  return {
    stack: 'node',
    label: `Node, ${manager} test${testScript ? '' : ' (add a "test" script to package.json)'}`,
    dir,
    setup: [...corepack, SETUP_NODE, `- name: Install\n        run: ${install}`],
    test: `${manager} test`,
  }
}

function stackFor(manifest: Manifest, dir: string, files: Set<string>, pkg: string | null): DetectedStack {
  switch (manifest) {
    case 'Anchor.toml':
      return { stack: 'anchor', label: 'Solana / Anchor, cargo test', dir, setup: [SETUP_RUST], test: 'cargo test --workspace' }
    case 'package.json':
      return nodeStack(dir, files, hasTestScript(pkg))
    case 'go.mod':
      return {
        stack: 'go',
        label: 'Go, go test',
        dir,
        setup: ['- uses: actions/setup-go@v5\n        with:\n          go-version: stable'],
        test: 'go test ./...',
      }
    case 'Cargo.toml':
      return { stack: 'rust', label: 'Rust, cargo test', dir, setup: [SETUP_RUST], test: 'cargo test --workspace' }
    case 'requirements.txt':
    case 'pyproject.toml':
    case 'setup.py':
      return {
        stack: 'python',
        label: 'Python, pytest',
        dir,
        setup: [
          '- uses: actions/setup-python@v5\n        with:\n          python-version: "3.12"',
          `- name: Install\n        run: pip install ${files.has('requirements.txt') ? '-r requirements.txt' : '-e .'} pytest`,
        ],
        test: 'pytest',
      }
  }
}

const STARTER: DetectedStack = {
  stack: 'unknown',
  label: 'a starter you edit',
  dir: '',
  setup: [],
  test: 'echo "Replace this line with the command that runs your tests" && exit 1',
}

/** Works out how a repository runs its tests from the files in its tree. Read access only. */
export async function detectStack(gh: Reader, owner: string, name: string, ref: string): Promise<DetectedStack> {
  const folder = projectFolder(await gh.listPaths(owner, name, ref))
  if (!folder) return STARTER
  const manifest = MANIFESTS.find((m) => folder.manifests.has(m))!
  const pkg = manifest === 'package.json' ? await gh.fileAt(owner, name, folder.dir ? `${folder.dir}/package.json` : 'package.json', ref) : null
  return stackFor(manifest, folder.dir, folder.manifests, pkg)
}

/** One job, "test", whose "Run tests" step is what bon travail watches and judges by. */
export function workflowYaml(detected: DetectedStack, branch: string): string {
  const steps = ['- uses: actions/checkout@v4', ...detected.setup, `- name: Run tests\n        run: ${detected.test}`]
  const workingDirectory = detected.dir ? ['    defaults:', '      run:', `        working-directory: ${detected.dir}`] : []
  return [
    'name: CI',
    '',
    'on:',
    '  push:',
    `    branches: [${branch}]`,
    '  pull_request:',
    '',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    ...workingDirectory,
    '    steps:',
    ...steps.map((step) => `      ${step}`),
    '',
  ].join('\n')
}

/** GitHub's own new-file page with the workflow filled in: the team reviews it and clicks Commit, and bon travail never writes. */
export function addWorkflowUrl(owner: string, name: string, branch: string, yaml: string): string {
  const params = new URLSearchParams({ filename: WORKFLOW_FILE, value: yaml })
  return `https://github.com/${owner}/${name}/new/${encodeURIComponent(branch)}?${params.toString()}`
}

export async function workflowSetup(gh: Reader & Pick<GitHubClient, 'getRepo'>, owner: string, name: string): Promise<WorkflowSetup> {
  const repo = await gh.getRepo(owner, name)
  if (repo.fork) return { kind: 'enable', actionsUrl: `${repo.htmlUrl}/actions` }
  const detected = await detectStack(gh, repo.owner, repo.name, repo.defaultBranch)
  const yaml = workflowYaml(detected, repo.defaultBranch)
  return { kind: 'add', stack: detected.stack, label: detected.label, yaml, url: addWorkflowUrl(repo.owner, repo.name, repo.defaultBranch, yaml) }
}
