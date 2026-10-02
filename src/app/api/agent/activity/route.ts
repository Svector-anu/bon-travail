import { handle, json } from '@/server/http'
import { agentActivity } from '@/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return handle(() => {
    const url = new URL(request.url)
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 40) || 40, 200)
    return json(agentActivity(limit, url.searchParams.get('task') ?? undefined))
  })
}
