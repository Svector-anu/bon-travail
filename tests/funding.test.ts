import { describe, expect, it } from 'vitest'
import type { Address, Hex } from '@/domain/types'
import type { Viewer } from '@/server/access'
import type { ChainReader, TransferRead } from '@/server/chain/chain-reader'
import type { ExternalizeInput } from '@/server/services/work-service'
import { FakeGitHub, NAME, OWNER, sha } from './fake-github'
import { T0, makeApp } from './helpers'

const HOUR = 60 * 60 * 1000
const DEPOSIT: Address = '0x5555555555555555555555555555555555555555'
const TEAM_WALLET: Address = '0x6666666666666666666666666666666666666666'
const OTHER_WALLET: Address = '0x7777777777777777777777777777777777777777'
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex

const ADMIN: Viewer = { actor: 'github:boss', operator: false, teams: new Map([[OWNER, 'admin']]) }
const ENGINEER: Viewer = { actor: 'github:dev', operator: false, teams: new Map([[OWNER, 'engineer']]) }
const OTHER_ADMIN: Viewer = { actor: 'github:else', operator: false, teams: new Map([['othercorp', 'admin']]) }

/** A chain where each test decides what a transaction did. */
class ScriptedChain implements ChainReader {
  readonly chainLabel = 'Arc Testnet'
  readonly explorerUrl = 'https://testnet.arcscan.app'
  readonly txs = new Map<string, TransferRead>()
  pay(hash: Hex, from: Address, recipient: Address, amountMicro: bigint): void {
    this.txs.set(hash, { kind: 'ok', fact: { from, recipient, amountMicro, blockNumber: 100n, source: 'erc20-transfer-log' } })
  }
  async readTransfer(hash: Hex): Promise<TransferRead> {
    return this.txs.get(hash) ?? { kind: 'not_found' }
  }
  async recentTransferCandidates(): Promise<Hex[]> {
    return []
  }
}

function work(reward: string): ExternalizeInput {
  return {
    reward,
    deadlineHours: 24,
    contributors: [{ login: 'ada', wallet: '0x3333333333333333333333333333333333333333' }],
    acceptance: 'The examples job passes on main.',
    scope: 'Fix it.',
    protectedPaths: [],
    requireMerge: true,
  }
}

/** acme on a team with a candidate finding, and a chain to deposit on. */
async function team() {
  const chain = new ScriptedChain()
  const github = new FakeGitHub()
  const app = await makeApp({ github, chain, env: { TARGET_OPEN_TASKS: '0', TEAM_DEPOSIT_ADDRESS: DEPOSIT } })
  github.addRun({ sha: sha('a1'), at: T0 - 4 * HOUR, conclusion: 'success' })
  github.addRun({ sha: sha('b1'), at: T0 - 3 * HOUR, conclusion: 'failure' })
  github.addRun({ sha: sha('c1'), at: T0 - 2 * HOUR, conclusion: 'failure' })
  await app.teams.recordSignIn('boss', [{ team: OWNER, installationId: 1, role: 'admin' }], T0)
  await app.work.connectRepo(`${OWNER}/${NAME}`, undefined, ADMIN)
  const finding = (await app.watch.listFindings())[0]!
  return { app, chain, finding }
}

describe('registering the wallet a team deposits from', () => {
  it('is for the team\'s GitHub admins only', async () => {
    const { app } = await team()
    await expect(app.funding.setFundingWallet(OWNER, TEAM_WALLET, ENGINEER)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(app.funding.setFundingWallet(OWNER, TEAM_WALLET, OTHER_ADMIN)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await app.funding.setFundingWallet(OWNER, TEAM_WALLET, ADMIN)).toBe(TEAM_WALLET)
  })

  it('cannot be bon travail\'s own deposit address', async () => {
    const { app } = await team()
    await expect(app.funding.setFundingWallet(OWNER, DEPOSIT, ADMIN)).rejects.toThrow(/bon travail's own address/)
  })
})

describe('crediting a deposit', () => {
  it('reads the transfer from the chain and credits it once', async () => {
    // #given a registered wallet that sent 2 USDC to the deposit address
    const { app, chain } = await team()
    await app.funding.setFundingWallet(OWNER, TEAM_WALLET, ADMIN)
    chain.pay(tx(1), TEAM_WALLET, DEPOSIT, 2_000_000n)
    // #when credited, then credited again
    const first = await app.funding.recordDeposit(OWNER, tx(1), ADMIN)
    // #then
    expect(first.amountMicro).toBe(2_000_000n)
    expect(first.balance).toMatchObject({ depositedMicro: 2_000_000n, availableMicro: 2_000_000n })
    await expect(app.funding.recordDeposit(OWNER, tx(1), ADMIN)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('refuses a transfer from any other wallet, so nobody can claim someone else\'s deposit', async () => {
    const { app, chain } = await team()
    await app.funding.setFundingWallet(OWNER, TEAM_WALLET, ADMIN)
    chain.pay(tx(2), OTHER_WALLET, DEPOSIT, 2_000_000n)
    await expect(app.funding.recordDeposit(OWNER, tx(2), ADMIN)).rejects.toThrow(/not acme's funding wallet/)
  })

  it('refuses a transfer that did not go to the deposit address', async () => {
    const { app, chain } = await team()
    await app.funding.setFundingWallet(OWNER, TEAM_WALLET, ADMIN)
    chain.pay(tx(3), TEAM_WALLET, OTHER_WALLET, 2_000_000n)
    await expect(app.funding.recordDeposit(OWNER, tx(3), ADMIN)).rejects.toThrow(/not the deposit address/)
  })

  it('waits for a transaction the chain does not have yet, and rejects a failed one', async () => {
    const { app, chain } = await team()
    await app.funding.setFundingWallet(OWNER, TEAM_WALLET, ADMIN)
    await expect(app.funding.recordDeposit(OWNER, tx(4), ADMIN)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    chain.txs.set(tx(5), { kind: 'failed_tx' })
    await expect(app.funding.recordDeposit(OWNER, tx(5), ADMIN)).rejects.toThrow(/failed onchain/)
  })

  it('needs a registered wallet and a well-formed hash first', async () => {
    const { app } = await team()
    await expect(app.funding.recordDeposit(OWNER, tx(6), ADMIN)).rejects.toThrow(/Register the wallet/)
    await app.funding.setFundingWallet(OWNER, TEAM_WALLET, ADMIN)
    await expect(app.funding.recordDeposit(OWNER, '0xabc', ADMIN)).rejects.toThrow(/64 hex/)
  })
})

describe('paying for work from the team\'s own funds', () => {
  it('lets a team admin post work once the team has deposited, and not past what is left', async () => {
    // #given acme deposited 1 USDC
    const { app, chain, finding } = await team()
    await app.funding.setFundingWallet(OWNER, TEAM_WALLET, ADMIN)
    chain.pay(tx(7), TEAM_WALLET, DEPOSIT, 1_000_000n)
    await app.funding.recordDeposit(OWNER, tx(7), ADMIN)
    // #when it posts 0.75 USDC of work
    const task = await app.work.externalize(finding.id, work('0.75'), ADMIN)
    // #then the reward is held against its balance
    expect(task.state).toBe('OPEN')
    expect(await app.funding.balance(OWNER)).toMatchObject({ heldMicro: 750_000n, availableMicro: 250_000n })
    await expect(app.funding.assertCanFund(OWNER, 500_000n)).rejects.toThrow(/0.25 USDC available/)
  })

  it('adds what bon travail sponsors to what the team deposited', async () => {
    const { app, chain } = await team()
    await app.teams.setBudget(OWNER, 500_000n, T0)
    await app.funding.setFundingWallet(OWNER, TEAM_WALLET, ADMIN)
    chain.pay(tx(8), TEAM_WALLET, DEPOSIT, 250_000n)
    await app.funding.recordDeposit(OWNER, tx(8), ADMIN)
    expect((await app.funding.balance(OWNER)).availableMicro).toBe(750_000n)
  })

  it('tells a team with nothing in it how to fund itself', async () => {
    const { app, finding } = await team()
    await expect(app.work.externalize(finding.id, work('0.5'), ADMIN)).rejects.toThrow(/Deposit USDC from your team wallet/)
  })
})
