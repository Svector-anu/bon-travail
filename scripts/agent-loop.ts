import { loadLocalEnv } from './env'

loadLocalEnv()
const { getApp } = await import('../src/server/container')

/**
 * Local stand-in for the Aeon schedule: one tick every AGENT_LOOP_SECONDS.
 * Runs against the same database as the web app.
 */
const everyMs = Number(process.env.AGENT_LOOP_SECONDS ?? 30) * 1000
const app = getApp()
let ticking = false
let stopping = false
let timer: ReturnType<typeof setTimeout> | null = null

process.on('SIGINT', () => {
  stopping = true
  if (timer) clearTimeout(timer)
  if (!ticking) process.exit(0)
})

async function tickOnce(): Promise<void> {
  ticking = true
  const report = await app.agent.tick('local-loop')
  ticking = false
  const stamp = new Date().toISOString().slice(11, 19)
  if (report.actions.length === 0) {
    console.log(`${stamp} ${report.status}: nothing to do (open: ${report.openTasks.join(', ') || 'none'})`)
  }
  for (const a of report.actions) {
    console.log(`${stamp} ${a.result.padEnd(7)} ${a.action.padEnd(20)} ${a.taskId ?? ''} ${a.detail}${a.error ? ` [${a.error}]` : ''}`)
  }
  if (!stopping) timer = setTimeout(() => void tickOnce(), everyMs)
}

console.log(`agent loop: ticking every ${everyMs / 1000}s (payments: ${app.payments.name}${app.payments.simulated ? ', simulated' : ''})`)
await tickOnce()
