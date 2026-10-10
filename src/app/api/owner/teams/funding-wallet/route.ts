import { getApp } from '@/server/container'
import { field, handle, json, readBody, requireConsoleRequest } from '@/server/http'

/** A team admin names the wallet the team deposits from. Deposits from any other wallet are not credited. */
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireConsoleRequest(request)
    const body = await readBody(request)
    const wallet = await (await getApp()).funding.setFundingWallet(field(body, 'team', 100).toLowerCase(), field(body, 'wallet', 64), viewer)
    return json({ wallet })
  })
}
