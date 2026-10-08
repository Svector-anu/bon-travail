import { getApp } from '@/server/container'
import { handle, json, requireConsoleRequest } from '@/server/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const viewer = await requireConsoleRequest(request)
    const finding = await (await getApp()).work.keepInternal((await params).id, viewer)
    return json({ id: finding.id, status: finding.status })
  })
}
