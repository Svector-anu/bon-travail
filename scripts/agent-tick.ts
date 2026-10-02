import { loadLocalEnv } from './env'

loadLocalEnv()
const { getApp } = await import('../src/server/container')

const report = await getApp().agent.tick('manual')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.status === 'error' ? 1 : 0
