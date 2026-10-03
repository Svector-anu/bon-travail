import { handle, json } from '@/server/http'
import { agentActivity } from '@/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url)
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 40) || 40, 200)
    return json(
      await agentActivity(limit, {
        taskId: url.searchParams.get('task') ?? undefined,
        findingId: url.searchParams.get('finding') ?? undefined,
      }),
    )
  })
}
