import { randomBytes } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex, TaskRecord } from '../src/domain/types'
import { loadLocalEnv } from './env'

/**
 * Seeds four tasks through the real engine so the UI has a truthful history:
 *   TASK-001 correct answer   -> PAID
 *   TASK-002 wrong answer     -> REJECTED, deadline passes -> REFUNDED
 *   TASK-003 no submission    -> OPEN with a short deadline; the agent loop
 *                                expires and refunds it while you watch
 *   TASK-004 correct answer   -> PAID
 * Then one agent tick tops up the supply with a fresh live task.
 *
 * Workers here are deterministic demo wallets driven by this script, and every
 * agent action it triggers is logged with source "demo-seed".
 */

loadLocalEnv()
process.env.TARGET_OPEN_TASKS = process.env.DEMO_TARGET_OPEN_TASKS ?? '2'

const dbPath = process.env.DATABASE_PATH || './data/pglite'
if (process.env.DATABASE_URL) {
  console.error('demo:seed writes scripted rail-test history; it refuses to run against a hosted DATABASE_URL.')
  process.exit(1)
}
if (process.argv.includes('--reset') && existsSync(dbPath)) {
  rmSync(dbPath, { recursive: true, force: true })
  console.log(`reset ${dbPath}`)
}

const { getApp } = await import('../src/server/container')
const { formatUsdc } = await import('../src/domain/money')
const app = await getApp()
const { tasks, agent, store, chain, clock } = app

if ((await store.listTasks({ limit: 1 })).length > 0) {
  console.error('Database already has tasks. Re-run with --reset to start a clean demo.')
  process.exit(1)
}

const demoWallet = (n: number) => privateKeyToAccount(keccak256(toHex(`proofwork-demo-worker-${n}`))).address
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const expirySeconds = Number(process.env.DEMO_EXPIRY_SECONDS ?? 120)

async function logRun(action: string, taskId: string, detail: string) {
  await store.insertRun({
    id: `run_${randomBytes(8).toString('hex')}`,
    tickId: null,
    source: 'demo-seed',
    action,
    taskId,
    at: clock.now(),
    result: 'ok',
    detail,
    error: null,
  })
}

const candidates: Hex[] = []
for (const hash of await chain.recentTransferCandidates(12)) if (!(await store.hasTaskForSubject(hash))) candidates.push(hash)
let next = 0

async function postTask(deadlineMs: number) {
  while (next < candidates.length) {
    const hash = candidates[next++]!
    try {
      const draft = await tasks.createTask(hash, 'agent', { deadlineMs })
      await logRun('create_task', draft.id, `Created from Arc Testnet tx ${hash.slice(0, 10)}...`)
      await tasks.fundTask(draft.id, 'agent')
      await logRun('fund', draft.id, `Reserved ${formatUsdc(draft.rewardMicro)} USDC`)
      const open = await tasks.publishTask(draft.id, 'agent')
      await logRun('publish', draft.id, `${open.title} is open`)
      return open
    } catch (error) {
      console.warn(`skipping ${hash}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error('Ran out of eligible Arc transactions to seed from')
}

async function work(taskId: string, worker: string, answer: { recipient: string; amount: string }) {
  const claim = await tasks.claimTask(taskId, worker)
  await tasks.submitTask(taskId, { claimId: claim.claimId, claimToken: claim.claimToken, ...answer })
}

const HOUR = 60 * 60 * 1000

function expectedOf(task: TaskRecord) {
  if (task.spec.kind !== 'tx-fact-check') throw new Error('demo seed only creates rail tests')
  return task.spec.expected
}

const t1 = await postTask(6 * HOUR)
await work(t1.id, demoWallet(1), { recipient: expectedOf(t1).recipient, amount: formatUsdc(expectedOf(t1).amountMicro) })
await agent.onSubmission(t1.id)
console.log(`${t1.id}: ${(await store.requireTask(t1.id)).state}`)

const t2 = await postTask(5_000)
await work(t2.id, demoWallet(2), { recipient: expectedOf(t2).recipient, amount: formatUsdc(expectedOf(t2).amountMicro + 10_000n) })
await tasks.verifySubmission(t2.id, 'agent:verifier')
await logRun('verify', t2.id, 'Submission rejected: Amount does not match the on-chain transfer.')
console.log(`${t2.id}: ${(await store.requireTask(t2.id)).state}, waiting for its deadline`)
await sleep(Math.max(0, t2.deadlineAt - clock.now()) + 250)

const t3 = await postTask(expirySeconds * 1000)
console.log(`${t3.id}: OPEN, expires in ${expirySeconds}s with no submission`)

const t4 = await postTask(6 * HOUR)
await work(t4.id, demoWallet(3), { recipient: expectedOf(t4).recipient, amount: formatUsdc(expectedOf(t4).amountMicro) })
await agent.onSubmission(t4.id)
console.log(`${t4.id}: ${(await store.requireTask(t4.id)).state}`)

const report = await agent.tick('demo-seed')
for (const a of report.actions) console.log(`tick ${a.result} ${a.action} ${a.taskId ?? ''} ${a.detail}`)
console.log(`open now: ${report.openTasks.join(', ')}`)
console.log('\nNext: npm run dev, and in another terminal AGENT_LOOP_SECONDS=15 npm run agent:loop')
