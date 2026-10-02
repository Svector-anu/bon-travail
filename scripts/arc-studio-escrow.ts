import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadLocalEnv } from './env'

/**
 * Drives Aeon's arc-studio skill locally: one detached Arc Studio turn that
 * writes, tests and deploys ProofworkEscrow, then `--poll` to collect the
 * result. Same script Aeon runs on its schedule (aeon/scripts/arc-studio-turn.mjs).
 *
 *   npm run arc:escrow            start the turn
 *   npm run arc:escrow -- --poll  attach and report the deployment
 */
loadLocalEnv()

function operatorAddress(): string {
  if (process.env.ARC_ESCROW_OPERATOR) return getAddress(process.env.ARC_ESCROW_OPERATOR)
  const key = process.env.ARC_PAYER_PRIVATE_KEY
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) return privateKeyToAccount(key as `0x${string}`).address
  throw new Error('Set ARC_PAYER_PRIVATE_KEY (or ARC_ESCROW_OPERATOR) so the escrow knows its operator')
}

const poll = process.argv.includes('--poll')
const prompt = poll
  ? 'poll'
  : readFileSync('aeon/arc-studio/escrow.prompt.md', 'utf8').replace('__OPERATOR_ADDRESS__', operatorAddress())

const result = spawnSync(process.execPath, ['aeon/scripts/arc-studio-turn.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SKILL_VAR: prompt,
    PATH: `${join(process.cwd(), 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
  },
})
process.exitCode = result.status ?? 1
