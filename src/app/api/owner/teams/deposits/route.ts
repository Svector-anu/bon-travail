import { formatUsdc } from '@/domain/money'
import { getApp } from '@/server/container'
import { field, handle, json, readBody, requireConsoleRequest } from '@/server/http'

export const maxDuration = 30

/** Credits one deposit after reading it from the chain. The browser only sends the transaction hash. */
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireConsoleRequest(request)
    const body = await readBody(request)
    const { amountMicro, balance } = await (await getApp()).funding.recordDeposit(field(body, 'team', 100).toLowerCase(), field(body, 'txHash', 80), viewer)
    return json({ credited: formatUsdc(amountMicro), available: formatUsdc(balance.availableMicro) }, 201)
  })
}
