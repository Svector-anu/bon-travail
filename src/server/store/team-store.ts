import type { TeamAccess, TeamRole } from '../github/oauth'
import { num, str } from './codec'
import { Repository } from './store'

export interface TeamRecord {
  id: string
  installationId: number
  /** USDC (micro-units) the team may hold in escrow at once. 0 until bon travail sponsors it or the team funds its own. */
  budgetMicro: bigint
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
        await this.run('INSERT INTO team_members (team_id, login, role, verified_at) VALUES ($1, $2, $3, $4)', t.team, who, t.role, at)
      }
    })
  }

  async membershipsOf(login: string): Promise<Map<string, TeamRole>> {
    const rows = await this.all('SELECT team_id, role FROM team_members WHERE login = $1', login.toLowerCase())
    return new Map(rows.map((row) => [str(row, 'team_id'), str(row, 'role') as TeamRole]))
  }

  async getTeam(id: string): Promise<TeamRecord | null> {
    const row = await this.get('SELECT * FROM teams WHERE id = $1', id.toLowerCase())
    return row ? { id: str(row, 'id'), installationId: num(row, 'installation_id'), budgetMicro: BigInt(str(row, 'budget_micro')) } : null
  }

  async listTeams(): Promise<(TeamRecord & { members: { login: string; role: TeamRole }[] })[]> {
    const teams = await this.all('SELECT * FROM teams ORDER BY id ASC')
    const members = await this.all('SELECT team_id, login, role FROM team_members ORDER BY login ASC')
    return teams.map((row) => ({
      id: str(row, 'id'),
      installationId: num(row, 'installation_id'),
      budgetMicro: BigInt(str(row, 'budget_micro')),
      members: members.filter((m) => str(m, 'team_id') === str(row, 'id')).map((m) => ({ login: str(m, 'login'), role: str(m, 'role') as TeamRole })),
    }))
  }

  async setBudget(id: string, budgetMicro: bigint, at: number): Promise<void> {
    await this.run('UPDATE teams SET budget_micro = $1, updated_at = $2 WHERE id = $3', budgetMicro.toString(), at, id.toLowerCase())
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
