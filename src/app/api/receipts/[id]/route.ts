import { DomainError } from '@/server/errors'
import { handle, json } from '@/server/http'
import { getReceiptView, recurrenceWatch } from '@/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const receipt = await getReceiptView(id)
    if (!receipt) throw new DomainError('NOT_FOUND', `Receipt ${id} not found`)
    return json({ ...receipt, recurrence: await recurrenceWatch(id) })
  })
}
