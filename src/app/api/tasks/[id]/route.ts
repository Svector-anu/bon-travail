import { DomainError } from '@/server/errors'
import { handle, json } from '@/server/http'
import { getTaskDetail } from '@/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const detail = getTaskDetail(id)
    if (!detail) throw new DomainError('NOT_FOUND', `Task ${id} not found`)
    return json(detail)
  })
}
