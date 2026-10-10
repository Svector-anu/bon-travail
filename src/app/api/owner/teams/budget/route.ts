import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { field, handle, json, readBody, requireConsoleRequest } from '@/server/http'
import { parseUsdc } from '@/domain/money'

/**
 * Operators set how much a team may hold in escrow at once. The money still
 * comes from the operator wallet, so only operators can change it.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireConsoleRequest(request)
    if (!viewer.operator) throw new DomainError('FORBIDDEN', 'Only bon travail operators can set a team budget')
    const body = await readBody(request)
    const team = field(body, 'team', 100).toLowerCase()
    const budget = parseUsdc(field(body, 'budget', 20))
    if (budget === null || budget < 0n) throw new DomainError('BAD_REQUEST', 'Budget must be a USDC amount')
    const app = await getApp()
    const { config } = app
    if (budget > config.maxOutstandingEscrowMicro) {
      throw new DomainError('BAD_REQUEST', 'A team budget cannot exceed the escrow cap for the whole deployment')
    }
    if (!(await app.teams.getTeam(team))) throw new DomainError('NOT_FOUND', `team ${team} not found`)
    await app.teams.setBudget(team, budget, app.clock.now())
    return json({ team, budget: body.budget })
  })
}
