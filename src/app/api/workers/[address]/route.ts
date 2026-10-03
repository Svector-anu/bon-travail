import { DomainError } from '@/server/errors'
import { handle, json } from '@/server/http'
import { workerSummary } from '@/server/queries'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  return handle(async () => {
    const summary = await workerSummary((await params).address)
    if (!summary) throw new DomainError('BAD_REQUEST', 'Not a valid address')
    return json(summary)
  })
}
