import type { TeamAccess, TeamRole } from '../github/oauth'
import { num, optStr, str } from './codec'
import type { Row } from './db'
import { Repository } from './store'

export interface TeamRecord {
  id: string
  installationId: number
  /** USDC (micro-units) bon travail sponsors this team with, on top of what it deposits. */
  budgetMicro: bigint
  /** The wallet the team deposits from; deposits from any other wallet are not credited. */
  fundingWallet: string | null
  /** Block height when that wallet was registered; only later transfers are credited. */
  fundingWalletBlock: bigint | null
}

export interface TeamDeposit {
  txHash: string
  team: string
  amountMicro: bigint
  from: string
  blockNumber: string
  creditedAt: number
  creditedBy: string
}

function rowToTeam(row: Row): TeamRecord {
  return {
    id: str(row, 'id'),
    installationId: num(row, 'installation_id'),
    budgetMicro: BigInt(str(row, 'budget_micro')),
    fundingWallet: optStr(row, 'funding_wallet'),
    fundingWalletBlock: optStr(row, 'funding_wallet_block') === null ? null : BigInt(optStr(row, 'funding_wallet_block')!),
  }
}

export interface AccessRequest {
  login: string
  attempts: number
  firstAt: number
  lastAt: number
}

/** Teams, who GitHub says is on them, and the people still waiting for access. */
export class TeamStore extends Repository {
  /** Replaces what is known about one person with what GitHub said at this sign-in. */
  async recordSignIn(login: string, teams: readonly TeamAccess[], at: number): Promise<void> {
    const who = login.toLowerCase()
    await this.transaction(async () => {
      await this.run('DELETE FROM team_members WHERE login = $1', who)
      for (const t of teams) {
        await this.run(
          `INSERT INTO teams (id, installation_id, budget_micro, created_at, updated_at) VALUES ($1, $2, '0', $3, $3)
           ON CONFLICT (id) DO UPDATE SET installation_id = EXCLUDED.installation_id, updated_at = EXCLUDED.updated_at`,
          t.team,
          t.installationId,
          at,
        )
        await this.run(
          'INSERT INTO team_members (team_id, login, role, verified_at, repos_json) VALUES ($1, $2, $3, $4, $5)',
          t.team,
          who,
          t.role,
          at,
          JSON.stringify(t.repos),
        )
      }
    })
  }

  /** Runs fn in a transaction holding this team's lock: concurrent spending for one team runs one at a time. */
  async withTeamLock<T>(team: string, fn: () => Promise<T>): Promise<T> {
    return this.transaction(async () => {
      await this.get('SELECT pg_advisory_xact_lock(hashtext($1))', `team:${team.toLowerCase()}`)
      return fn()
    })
  }

  /** Teams and repos GitHub confirmed for this person at a sign-in no older than `since` (epoch ms). */
  async membershipsOf(login: string, since = 0): Promise<{ teams: Map<string, TeamRole>; repos: Map<string, TeamRole> }> {
    const rows = await this.all('SELECT team_id, role, repos_json FROM team_members WHERE login = $1 AND verified_at >= $2', login.toLowerCase(), since)
    const repos = new Map<string, TeamRole>()
    for (const row of rows) {
      for (const [repo, role] of Object.entries(JSON.parse(str(row, 'repos_json')) as Record<string, TeamRole>)) repos.set(repo, role)
    }
    return { teams: new Map(rows.map((row) => [str(row, 'team_id'), str(row, 'role') as TeamRole])), repos }
  }

  async getTeam(id: string): Promise<TeamRecord | null> {
    const row = await this.get('SELECT * FROM teams WHERE id = $1', id.toLowerCase())
    return row ? rowToTeam(row) : null
  }

  async listTeams(): Promise<(TeamRecord & { members: { login: string; role: TeamRole }[] })[]> {
    const teams = await this.all('SELECT * FROM teams ORDER BY id ASC')
    const members = await this.all('SELECT team_id, login, role FROM team_members ORDER BY login ASC')
    return teams.map((row) => ({
      ...rowToTeam(row),
      members: members.filter((m) => str(m, 'team_id') === str(row, 'id')).map((m) => ({ login: str(m, 'login'), role: str(m, 'role') as TeamRole })),
    }))
  }

  async setBudget(id: string, budgetMicro: bigint, at: number): Promise<void> {
    await this.run('UPDATE teams SET budget_micro = $1, updated_at = $2 WHERE id = $3', budgetMicro.toString(), at, id.toLowerCase())
  }

  /** The team that already registered this wallet, if any. */
  async teamWithWallet(wallet: string): Promise<string | null> {
    const row = await this.get('SELECT id FROM teams WHERE LOWER(funding_wallet) = $1', wallet.toLowerCase())
    return row ? str(row, 'id') : null
  }

  async setFundingWallet(id: string, wallet: string, block: bigint, at: number): Promise<void> {
    await this.run(
      'UPDATE teams SET funding_wallet = $1, funding_wallet_block = $2, updated_at = $3 WHERE id = $4',
      wallet,
      block.toString(),
      at,
      id.toLowerCase(),
    )
  }

  /** Credits a deposit once. Returns false if that transaction was already credited, to this team or any other. */
  async recordDeposit(deposit: TeamDeposit): Promise<boolean> {
    const inserted = await this.run(
      `INSERT INTO team_deposits (tx_hash, team_id, amount_micro, from_address, block_number, credited_at, credited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tx_hash) DO NOTHING`,
      deposit.txHash.toLowerCase(),
      deposit.team.toLowerCase(),
      deposit.amountMicro.toString(),
      deposit.from,
      deposit.blockNumber,
      deposit.creditedAt,
      deposit.creditedBy,
    )
    return inserted === 1
  }

  async depositedMicro(team: string): Promise<bigint> {
    const rows = await this.all('SELECT amount_micro FROM team_deposits WHERE team_id = $1', team.toLowerCase())
    return rows.reduce((sum, row) => sum + BigInt(str(row, 'amount_micro')), 0n)
  }

  async listDeposits(team: string, limit = 20): Promise<TeamDeposit[]> {
    return (await this.all('SELECT * FROM team_deposits WHERE team_id = $1 ORDER BY credited_at DESC LIMIT $2', team.toLowerCase(), limit)).map(
      (row) => ({
        txHash: str(row, 'tx_hash'),
        team: str(row, 'team_id'),
        amountMicro: BigInt(str(row, 'amount_micro')),
        from: str(row, 'from_address'),
        blockNumber: str(row, 'block_number'),
        creditedAt: num(row, 'credited_at'),
        creditedBy: str(row, 'credited_by'),
      }),
    )
  }

  /** Counts an attempt; returns the person's record and how many distinct people have asked so far. */
  async recordAccessRequest(login: string, at: number): Promise<{ request: AccessRequest; firstTime: boolean; people: number }> {
    return this.transaction(async () => {
      const who = login.toLowerCase()
      const before = await this.get('SELECT attempts FROM access_requests WHERE login = $1', who)
      await this.run(
        `INSERT INTO access_requests (login, attempts, first_at, last_at) VALUES ($1, 1, $2, $2)
         ON CONFLICT (login) DO UPDATE SET attempts = access_requests.attempts + 1, last_at = EXCLUDED.last_at`,
        who,
        at,
      )
      const row = (await this.get('SELECT * FROM access_requests WHERE login = $1', who))!
      const count = await this.get('SELECT COUNT(*) AS n FROM access_requests')
      return {
        request: { login: str(row, 'login'), attempts: num(row, 'attempts'), firstAt: num(row, 'first_at'), lastAt: num(row, 'last_at') },
        firstTime: before === undefined,
        people: count ? num(count, 'n') : 1,
      }
    })
  }

  async listAccessRequests(limit = 50): Promise<AccessRequest[]> {
    return (await this.all('SELECT * FROM access_requests ORDER BY last_at DESC LIMIT $1', limit)).map((row) => ({
      login: str(row, 'login'),
      attempts: num(row, 'attempts'),
      firstAt: num(row, 'first_at'),
      lastAt: num(row, 'last_at'),
    }))
  }
}
