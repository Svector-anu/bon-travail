import { checkAddress } from '@/domain/address'
import { formatUsdc } from '@/domain/money'
import { TASK_KIND_CI_FIX, type Hex, type TaskRecord } from '@/domain/types'
import { canFund, type Viewer } from '../access'
import type { ChainReader } from '../chain/chain-reader'
import type { Clock } from '../clock'
import { DomainError } from '../errors'
import type { TeamStore } from '../store/team-store'
import type { TaskService } from './task-service'

const TX_HASH = /^0x[0-9a-fA-F]{64}$/
const ESCROWED: readonly TaskRecord['state'][] = ['FUNDED', 'OPEN', 'CLAIMED', 'SUBMITTED', 'VERIFYING', 'ACCEPTED']

export interface TeamBalance {
  /** What bon travail sponsors the team with. */
  sponsoredMicro: bigint
  /** Verified deposits from the team's own wallet. */
  depositedMicro: bigint
  /** Rewards already paid out for the team's work. */
  paidMicro: bigint
  /** Rewards set aside in escrow for open work. */
  heldMicro: bigint
  /** What the team can still put behind new work. Never below zero. */
  availableMicro: bigint
}

/**
 * Each team pays for its own work. A team registers the wallet it pays from
 * and sends USDC to the deposit address; every deposit is read back from the
 * chain before it is credited, and credited once. Rewards for a team's work
 * come only out of what that team deposited, plus anything bon travail chose
 * to sponsor. Refunded work flows back into the balance on its own.
 */
export class TeamFunding {
  constructor(
    private readonly teams: Pick<TeamStore, 'getTeam' | 'setFundingWallet' | 'recordDeposit' | 'depositedMicro'>,
    private readonly tasks: Pick<TaskService, 'listWorkTasks'>,
    private readonly chain: ChainReader,
    private readonly clock: Clock,
    /** Where teams send deposits: the treasury that pays rewards. Null when payments are simulated. */
    readonly depositAddress: string | null,
    /** Wallets that can never be a team's funding wallet (the escrow contract). */
    private readonly reserved: readonly string[] = [],
  ) {}

  async balance(team: string): Promise<TeamBalance> {
    const id = team.toLowerCase()
    const record = await this.teams.getTeam(id)
    const sponsoredMicro = record?.budgetMicro ?? 0n
    const depositedMicro = await this.teams.depositedMicro(id)
    let paidMicro = 0n
    let heldMicro = 0n
    for (const task of await this.tasks.listWorkTasks([...ESCROWED, 'PAID'])) {
      if (task.spec.kind !== TASK_KIND_CI_FIX || task.spec.repo.owner.toLowerCase() !== id) continue
      if (task.state === 'PAID') paidMicro += task.rewardMicro
      else heldMicro += task.rewardMicro
    }
    const left = sponsoredMicro + depositedMicro - paidMicro - heldMicro
    return { sponsoredMicro, depositedMicro, paidMicro, heldMicro, availableMicro: left > 0n ? left : 0n }
  }

  /** Called before work is funded: the reward must fit in what the team has left. */
  async assertCanFund(team: string, rewardMicro: bigint): Promise<void> {
    const b = await this.balance(team)
    if (rewardMicro <= b.availableMicro) return
    if (b.sponsoredMicro === 0n && b.depositedMicro === 0n) {
      throw new DomainError('FORBIDDEN', `${team} has no funds for paid work yet. Deposit USDC from your team wallet in the console, or ask bon travail to sponsor your pilot.`)
    }
    throw new DomainError(
      'FORBIDDEN',
      `${team} has ${formatUsdc(b.availableMicro)} USDC available (${formatUsdc(b.heldMicro)} set aside for open work, ${formatUsdc(b.paidMicro)} paid out). Deposit more to post ${formatUsdc(rewardMicro)} USDC of work.`,
    )
  }

  private requireFunder(team: string, viewer: Viewer): void {
    if (!canFund(viewer, team)) throw new DomainError('FORBIDDEN', `Only an admin of ${team} on GitHub can manage its funds`)
  }

  async setFundingWallet(team: string, raw: string, viewer: Viewer): Promise<string> {
    this.requireFunder(team, viewer)
    if (!(await this.teams.getTeam(team))) throw new DomainError('NOT_FOUND', `team ${team} not found`)
    const wallet = checkAddress(raw.trim())
    if (!wallet.ok) throw new DomainError('BAD_REQUEST', `Funding wallet ${wallet.reason}`)
    const taken = [this.depositAddress, ...this.reserved].filter(Boolean).map((a) => a!.toLowerCase())
    if (taken.includes(wallet.address.toLowerCase())) throw new DomainError('BAD_REQUEST', 'That is bon travail\'s own address, not a team wallet')
    await this.teams.setFundingWallet(team, wallet.address, this.clock.now())
    return wallet.address
  }

  /**
   * Credits one deposit after reading it from the chain: it must be a single
   * USDC transfer from the team's funding wallet to the deposit address. The
   * browser only supplies the hash; every fact comes from the chain.
   */
  async recordDeposit(team: string, rawHash: string, viewer: Viewer): Promise<{ amountMicro: bigint; balance: TeamBalance }> {
    this.requireFunder(team, viewer)
    if (!this.depositAddress) throw new DomainError('UNAVAILABLE', 'Deposits are off: payments are simulated in this deployment')
    const record = await this.teams.getTeam(team)
    if (!record) throw new DomainError('NOT_FOUND', `team ${team} not found`)
    if (!record.fundingWallet) throw new DomainError('BAD_REQUEST', 'Register the wallet you deposit from first')
    const hash = rawHash.trim()
    if (!TX_HASH.test(hash)) throw new DomainError('BAD_REQUEST', 'Paste the transaction hash: 0x followed by 64 hex characters')

    const read = await this.chain.readTransfer(hash as Hex)
    if (read.kind === 'not_found') throw new DomainError('NOT_FOUND', 'That transaction is not on the chain yet. Wait for it to confirm, then try again.')
    if (read.kind === 'failed_tx') throw new DomainError('BAD_REQUEST', 'That transaction failed onchain, so nothing was deposited')
    if (read.kind === 'ambiguous') throw new DomainError('BAD_REQUEST', `That is not a single USDC transfer: ${read.reason}`)
    const { fact } = read
    if (fact.recipient.toLowerCase() !== this.depositAddress.toLowerCase()) {
      throw new DomainError('BAD_REQUEST', `That transfer went to ${fact.recipient}, not the deposit address ${this.depositAddress}`)
    }
    if (fact.from.toLowerCase() !== record.fundingWallet.toLowerCase()) {
      throw new DomainError('BAD_REQUEST', `That transfer came from ${fact.from}, not ${team}'s funding wallet ${record.fundingWallet}`)
    }
    if (fact.amountMicro <= 0n) throw new DomainError('BAD_REQUEST', 'That transfer moved no USDC')

    const credited = await this.teams.recordDeposit({
      txHash: hash,
      team,
      amountMicro: fact.amountMicro,
      from: fact.from,
      blockNumber: fact.blockNumber.toString(),
      creditedAt: this.clock.now(),
      creditedBy: viewer.actor,
    })
    if (!credited) throw new DomainError('CONFLICT', 'That deposit was already credited')
    return { amountMicro: fact.amountMicro, balance: await this.balance(team) }
  }
}
