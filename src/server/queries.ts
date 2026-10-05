import { checkAddress } from '@/domain/address'
import { investigationIsCurrent, NEEDS_DECISION, type FindingStatus } from '@/domain/findings'
import { formatUsdc, parseUsdc } from '@/domain/money'
import { isTerminal } from '@/domain/task-state'
import { TASK_KIND_CI_FIX, type TaskKind, type TaskRecord } from '@/domain/types'
import type {
  AgentRunView,
  AgentStatusView,
  AttemptView,
  FindingSummaryView,
  FindingView,
  ReceiptView,
  RecurrenceWatch,
  RepoView,
  TaskView,
} from '@/domain/views'
import { publicRun } from '@/lib/public-activity'
import { loadConfig } from './config'
import { getApp, type App } from './container'
import { displayId, findingDisplayIdOf, toAttemptView, toFindingSummary, toFindingView, toRepoView, toTaskView } from './services/views'

/** Where a work package stands, read from its event log. */
export interface WorkProgress {
  claimedPrUrl: string | null
  waitingFor: string | null
  lastError: string | null
}

export interface TaskDetail {
  task: TaskView
  attempts: AttemptView[]
  work: WorkProgress | null
}

export interface ActivitySnapshot {
  status: AgentStatusView
  runs: AgentRunView[]
}

function viewContext(app: App) {
  return { explorerUrl: app.chain.explorerUrl }
}

async function toViews(app: App, tasks: TaskRecord[]): Promise<TaskView[]> {
  const counts = await app.store.countAttempts(tasks.map((t) => t.id))
  return tasks.map((t) => toTaskView(t, counts.get(t.id) ?? 0, viewContext(app)))
}

/** How many items a list page shows; enough to scan, few enough to load fast. */
export const PAGE_SIZE = 12

export interface ListPage<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

const SETTLED_STATES = ['PAID', 'REFUNDED', 'EXPIRED'] as const
const RECEIPT_STATES = ['PAID', 'REFUNDED'] as const

const totalPayout = (task: TaskView): bigint => (parseUsdc(task.reward) ?? 0n) + (task.ci?.bonusUsdc ? (parseUsdc(task.ci.bonusUsdc) ?? 0n) : 0n)

/**
 * Open work in the order a human should see it: what can be claimed now
 * first, the largest total payout first, then the soonest deadline. Work
 * someone is already on follows.
 */
export function rankOpenWork(tasks: TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => {
    const claimable = Number(b.state === 'OPEN') - Number(a.state === 'OPEN')
    if (claimable !== 0) return claimable
    const pay = totalPayout(b) - totalPayout(a)
    if (pay !== 0n) return pay > 0n ? 1 : -1
    return a.deadlineAt - b.deadlineAt
  })
}

const pageNumber = (page: number, total: number) => Math.min(Math.max(1, Math.floor(page) || 1), Math.max(1, Math.ceil(total / PAGE_SIZE)))

export async function listWorkPage(view: 'open' | 'settled', page: number): Promise<{ list: ListPage<TaskView>; counts: { open: number; settled: number } }> {
  const app = await getApp()
  const [open, settled] = await Promise.all([app.store.countTasks({ states: LIVE_STATES }), app.store.countTasks({ states: SETTLED_STATES })])
  const total = view === 'open' ? open : settled
  const current = pageNumber(page, total)
  const items =
    view === 'open'
      ? rankOpenWork(await toViews(app, await app.store.listTasks({ states: LIVE_STATES, limit: 500 }))).slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
      : await toViews(app, await app.store.listTasks({ states: SETTLED_STATES, limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE }))
  return { list: { items, page: current, pageSize: PAGE_SIZE, total }, counts: { open, settled } }
}

export async function listReceiptPage(page: number): Promise<ListPage<TaskView>> {
  const app = await getApp()
  const total = await app.store.countTasks({ states: RECEIPT_STATES })
  const current = pageNumber(page, total)
  const items = await toViews(app, await app.store.listTasks({ states: RECEIPT_STATES, limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE }))
  return { items, page: current, pageSize: PAGE_SIZE, total }
}

export async function listTaskViews(options: { limit?: number; kinds?: TaskKind[] } = {}): Promise<TaskView[]> {
  const app = await getApp()
  return toViews(app, await app.store.listTasks({ limit: options.limit ?? 50, kinds: options.kinds }))
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const app = await getApp()
  const task = await app.store.getTask(taskId)
  if (!task) return null
  const attempts = await app.store.listAttempts(task.id)
  let work: WorkProgress | null = null
  if (task.kind === TASK_KIND_CI_FIX) {
    const events = await app.store.listEvents(task.id)
    const claimed = events.findLast((e) => e.type === 'claimed')
    const last = events.at(-1)
    work = {
      claimedPrUrl: typeof claimed?.detail.prUrl === 'string' ? claimed.detail.prUrl : null,
      waitingFor: last?.type === 'verification_pending' && typeof last.detail.waitingFor === 'string' ? last.detail.waitingFor : null,
      lastError: last?.type === 'verification_error' && typeof last.detail.error === 'string' ? last.detail.error : null,
    }
  }
  return {
    task: toTaskView(task, attempts.length, viewContext(app)),
    attempts: attempts.filter((a) => a.submittedAt !== null).map((a) => toAttemptView(a, isTerminal(task.state))),
    work,
  }
}

export async function getReceiptView(taskId: string): Promise<ReceiptView | null> {
  const app = await getApp()
  return (await app.store.getTask(taskId)) ? app.tasks.getReceipt(taskId) : null
}

/**
 * The agent's run log. Work packages are public once a team posts them, but a
 * run about a repository or a failure the team has not decided on stays
 * private: the public sees what kind of thing happened and no names.
 */
export async function agentActivity(
  limit = 40,
  filter: { taskId?: string; findingId?: string } = {},
  audience: 'owner' | 'public' = 'public',
): Promise<ActivitySnapshot> {
  const { agent, store } = await getApp()
  if (audience === 'public' && filter.findingId) return { status: redactStatus(await agent.status()), runs: [] }
  const [status, runs] = await Promise.all([agent.status(), store.listRuns(limit, filter)])
  if (audience === 'owner') return { status, runs }
  return {
    status: redactStatus(status),
    runs: runs.map(publicRun),
  }
}

function redactStatus(status: AgentStatusView): AgentStatusView {
  return { ...status, lastTickSummary: null }
}

const LIVE_STATES = ['OPEN', 'CLAIMED', 'SUBMITTED', 'VERIFYING', 'ACCEPTED', 'REJECTED'] as const

/** The escrow contract on the Arc explorer, for the footer; null when payouts are not escrowed. */
export async function escrowExplorerUrl(): Promise<string | null> {
  const app = await getApp()
  const address = app.config.paymentProvider === 'arc-escrow' ? app.config.arcEscrowAddress : undefined
  return address ? `${app.chain.explorerUrl}/address/${address}` : null
}

/** The same link from configuration alone, for the page shell: no database, so every page around it can be cached. */
export function escrowExplorerUrlFromConfig(): string | null {
  try {
    const config = loadConfig()
    return config.paymentProvider === 'arc-escrow' && config.arcEscrowAddress ? `${config.arcExplorerUrl}/address/${config.arcEscrowAddress}` : null
  } catch {
    return null
  }
}

/** The work package the home page points to: the first one open to contributors, else the newest in flight. */
export async function openWork(): Promise<TaskView | null> {
  const app = await getApp()
  const live = await toViews(app, await app.store.listTasks({ states: LIVE_STATES, limit: 10, kinds: [TASK_KIND_CI_FIX] }))
  return live.find((t) => t.state === 'OPEN') ?? live[0] ?? null
}

export interface ConsoleSnapshot {
  repos: RepoView[]
  /** Repositories the GitHub App is installed on and not watched yet. */
  installable: { slug: string; private: boolean }[]
  installUrl: string | null
  githubError: string | null
  needsDecision: FindingSummaryView[]
  watching: FindingSummaryView[]
  inFlight: { finding: FindingSummaryView; task: TaskView | null }[]
  settled: FindingSummaryView[]
  githubEnabled: boolean
  simulatedPayments: boolean
  paymentProvider: string
}

const IN_FLIGHT: readonly FindingStatus[] = ['internal', 'externalized']
const SETTLED: readonly FindingStatus[] = ['resolved', 'dismissed']

export async function consoleSnapshot(): Promise<ConsoleSnapshot> {
  const app = await getApp()
  const repos = await app.watch.listRepos()
  const bySlug = new Map(repos.map((r) => [r.id, r]))
  const findings = await app.watch.listFindings({ limit: 200 })
  const summary = (status: readonly FindingStatus[]) =>
    findings.filter((f) => status.includes(f.status)).map((f) => toFindingSummary(f, bySlug.get(f.repoId) ?? { owner: '?', name: f.repoId }))
  const inFlight = await Promise.all(
    findings
      .filter((f) => IN_FLIGHT.includes(f.status))
      .map(async (f) => {
        const task = f.taskId ? await app.store.getTask(f.taskId) : null
        return {
          finding: toFindingSummary(f, bySlug.get(f.repoId) ?? { owner: '?', name: f.repoId }),
          task: task ? (await toViews(app, [task]))[0]! : null,
        }
      }),
  )
  let installable: ConsoleSnapshot['installable'] = []
  let githubError: string | null = null
  if (app.githubApp) {
    try {
      const watched = new Set(repos.filter((r) => r.active).map((r) => r.id))
      installable = (await app.githubApp.listRepos())
        .filter((r) => !watched.has(`${r.owner}/${r.name}`.toLowerCase()))
        .map((r) => ({ slug: `${r.owner}/${r.name}`, private: r.private }))
    } catch (error) {
      githubError = error instanceof Error ? error.message : 'GitHub is unreachable'
    }
  }
  return {
    repos: repos.map(toRepoView),
    installable,
    installUrl: app.githubApp?.installUrl ?? null,
    githubError,
    needsDecision: summary(NEEDS_DECISION),
    watching: summary(['watching']),
    inFlight,
    settled: summary(SETTLED),
    githubEnabled: app.github !== null,
    simulatedPayments: app.payments.simulated,
    paymentProvider: app.payments.name,
  }
}

export interface FindingDetail {
  finding: FindingView
  task: TaskView | null
  pastTasks: TaskView[]
  maxReward: string
  simulatedPayments: boolean
}

export async function getFindingDetail(findingId: string): Promise<FindingDetail | null> {
  const app = await getApp()
  const finding = await app.watch.getFinding(findingId)
  if (!finding) return null
  const repo = await app.watch.requireRepo(finding.repoId)
  const [runs, events] = await Promise.all([app.watch.runsForFinding(finding.id, 20), app.watch.listFindingEvents(finding.id)])
  const taskIds = [...new Set(events.map((e) => e.detail.taskId).filter((id): id is string => typeof id === 'string'))]
  const tasks = (await Promise.all(taskIds.map((id) => app.store.getTask(id)))).filter((t): t is TaskRecord => t !== null)
  const views = await toViews(app, tasks)
  // A settled package belongs to an earlier episode: once the failure comes back, the engineer decides again.
  const current = views.find((t) => t.id === finding.taskId && !isTerminal(t.state)) ?? null
  return {
    finding: toFindingView(finding, repo, runs, events),
    task: current,
    pastTasks: views.filter((t) => t.id !== current?.id),
    maxReward: formatUsdc(app.config.maxRewardMicro),
    simulatedPayments: app.payments.simulated,
  }
}

/** Live recurrence status for a work package, shown next to (never inside) its frozen receipt. */
export async function recurrenceWatch(taskId: string): Promise<RecurrenceWatch | null> {
  const app = await getApp()
  const task = await app.store.getTask(taskId)
  if (!task || task.spec.kind !== TASK_KIND_CI_FIX) return null
  const finding = await app.watch.getFinding(task.spec.findingId)
  if (!finding) return null
  const repo = await app.watch.getRepo(finding.repoId)
  const since = finding.resolvedAt ?? task.settledAt ?? task.createdAt
  return {
    findingId: finding.id,
    findingDisplayId: findingDisplayIdOf(finding),
    status: finding.status,
    greenRunsSinceFix: await app.watch.greenRunsSince(finding.repoId, since - 1),
    recurrenceCount: finding.recurrenceCount,
    lastRecurrenceAt: finding.lastRecurrenceAt,
    resolvedSha: finding.resolvedSha,
    lastPolledAt: repo?.lastPolledAt ?? null,
  }
}

/** What Aeon reads before it investigates: only findings awaiting evidence, with everything needed to reproduce. */
export async function findingsForInvestigation(statuses: FindingStatus[]) {
  const app = await getApp()
  const findings = await app.watch.listFindings({ statuses, limit: 20 })
  return Promise.all(
    findings.map(async (f) => {
      const repo = await app.watch.requireRepo(f.repoId)
      return {
        id: f.id,
        displayId: findingDisplayIdOf(f),
        status: f.status,
        repo: `${repo.owner}/${repo.name}`,
        cloneUrl: `https://github.com/${repo.owner}/${repo.name}.git`,
        defaultBranch: repo.defaultBranch,
        workflowPath: f.workflowPath,
        jobName: f.jobName,
        stepName: f.stepName,
        stepCommand: f.stepCommand,
        errorExcerpt: f.errorExcerpt,
        failureCount: f.failureCount,
        firstFailedSha: f.firstFailedSha,
        lastFailedRunUrl: f.lastFailedRunUrl,
        lastGreenSha: f.regression?.lastGreenSha ?? null,
        regressionCommits: f.regression?.commits ?? [],
        // An investigation older than the latest recurrence explains the previous episode, not this one.
        alreadyInvestigated: investigationIsCurrent(f),
        recurrenceCount: f.recurrenceCount,
      }
    }),
  )
}

export interface WorkerSummary {
  address: string
  earned: string | null
  paidCount: number
  answered: number
  rejected: number
  activeClaim: { taskId: string; displayId: string; expiresAt: number } | null
  history: { taskId: string; displayId: string; outcome: string; at: number }[]
}

/** Everything one wallet has done, read straight from attempts and the payout ledger. */
export async function workerSummary(addressInput: string): Promise<WorkerSummary | null> {
  const check = checkAddress(addressInput)
  if (!check.ok) return null
  const { store } = await getApp()
  const attempts = await store.listAttemptsByWorker(check.address)
  const payouts = await store.confirmedPayoutsTo(check.address)
  const earnedMicro = payouts.reduce((sum, p) => sum + p.amountMicro, 0n)
  const tasks = new Map<string, TaskRecord>()
  for (const id of new Set(attempts.map((a) => a.taskId))) {
    const task = await store.getTask(id)
    if (task) tasks.set(id, task)
  }
  const label = (taskId: string) => {
    const task = tasks.get(taskId)
    return task ? displayId(task) : taskId
  }
  const active = attempts.find((a) => {
    const task = tasks.get(a.taskId)
    return task?.state === 'CLAIMED' && task.claimId === a.claimId
  })
  return {
    address: check.address,
    earned: earnedMicro > 0n ? formatUsdc(earnedMicro) : null,
    paidCount: payouts.length,
    answered: attempts.filter((a) => a.submittedAt !== null).length,
    rejected: attempts.filter((a) => a.outcome === 'FAIL').length,
    activeClaim: active ? { taskId: active.taskId, displayId: label(active.taskId), expiresAt: active.claimExpiresAt } : null,
    history: attempts
      .filter((a) => a.outcome !== null)
      .map((a) => ({ taskId: a.taskId, displayId: label(a.taskId), outcome: a.outcome!, at: a.submittedAt ?? a.claimedAt })),
  }
}

/** The most recent paid work package's sealed receipt: the home page tells its story. */
/** Where each piece of work stands right now, counted from real findings and tasks. Public: counts only. */
export interface AgentPipeline {
  reposWatched: number
  runsObserved: number
  stages: { key: string; label: string; count: number }[]
}

export async function agentPipeline(): Promise<AgentPipeline> {
  const app = await getApp()
  const [repos, findings, tasks, runs] = await Promise.all([
    app.watch.listRepos(true),
    app.watch.listFindings({ limit: 500 }),
    app.store.listTasks({ kinds: [TASK_KIND_CI_FIX], limit: 500 }),
    app.store.database.query('SELECT COUNT(*) AS n FROM workflow_runs'),
  ])
  const byTask = new Map(tasks.map((t) => [t.id, t]))
  const count = (predicate: (f: (typeof findings)[number]) => boolean) => findings.filter(predicate).length
  const taskState = (f: (typeof findings)[number]) => (f.taskId ? byTask.get(f.taskId)?.state : undefined)
  return {
    reposWatched: repos.length,
    runsObserved: Number(runs.rows[0]?.n ?? 0),
    stages: [
      { key: 'observing', label: 'Observing', count: count((f) => f.status === 'watching') },
      { key: 'investigating', label: 'Investigating', count: count((f) => f.status === 'candidate' || f.status === 'recurred') },
      { key: 'awaiting', label: 'Awaiting approval', count: count((f) => f.status === 'investigated') },
      { key: 'open', label: 'Open to humans', count: count((f) => f.status === 'externalized' && ['DRAFT', 'FUNDED', 'OPEN'].includes(taskState(f) ?? '')) },
      { key: 'assigned', label: 'Being fixed', count: count((f) => f.status === 'externalized' && taskState(f) === 'CLAIMED') },
      {
        key: 'verifying',
        label: 'Verifying',
        count: count((f) => f.status === 'externalized' && ['SUBMITTED', 'VERIFYING', 'ACCEPTED'].includes(taskState(f) ?? '')),
      },
      { key: 'paid', label: 'Paid', count: tasks.filter((t) => t.state === 'PAID').length },
      { key: 'watching', label: 'Watching again', count: count((f) => f.status === 'resolved') },
    ],
  }
}

export interface ContributorEntry {
  taskId: string
  displayId: string
  title: string
  state: string
  reward: string
  claimedAt: number
  outcome: string | null
  payoutTxUrl: string | null
  simulated: boolean
}

export interface ContributorLedger {
  query: string
  kind: 'login' | 'wallet'
  earned: string
  paidCount: number
  entries: ContributorEntry[]
}

/**
 * A contributor's record, looked up by GitHub login or payout wallet. Public
 * by design: every line is already on a public work page or receipt.
 */
export async function contributorLedger(input: string): Promise<ContributorLedger | null> {
  const query = input.trim().replace(/^@/, '')
  if (!query) return null
  const app = await getApp()
  const wallet = checkAddress(query)
  const attempts = wallet.ok
    ? await app.store.listAttemptsByWorker(wallet.address)
    : /^[A-Za-z0-9-]{1,39}$/.test(query)
      ? await app.store.listAttemptsByHandle(query)
      : null
  if (!attempts) return null
  const entries: ContributorEntry[] = []
  let earned = 0n
  let paidCount = 0
  for (const taskId of [...new Set(attempts.map((a) => a.taskId))]) {
    const task = await app.store.getTask(taskId)
    if (!task) continue
    const mine = attempts.filter((a) => a.taskId === taskId)
    const payout = await app.store.getPayment(taskId, 'release')
    const paidToMe = payout?.status === 'confirmed' && mine.some((a) => a.worker === payout.recipient && a.outcome === 'PASS')
    if (paidToMe) {
      earned += payout.amountMicro
      paidCount++
    }
    entries.push({
      taskId,
      displayId: displayId(task),
      title: task.title,
      state: task.state,
      reward: formatUsdc(task.rewardMicro),
      claimedAt: Math.max(...mine.map((a) => a.claimedAt)),
      outcome: paidToMe ? 'PAID' : (mine.at(-1)?.outcome ?? null),
      payoutTxUrl: paidToMe && payout.txHash && payout.provider !== 'mock' ? `${app.chain.explorerUrl.replace(/\/$/, '')}/tx/${payout.txHash}` : null,
      simulated: paidToMe && payout.provider === 'mock',
    })
  }
  entries.sort((a, b) => b.claimedAt - a.claimedAt)
  return { query, kind: wallet.ok ? 'wallet' : 'login', earned: formatUsdc(earned), paidCount, entries }
}
