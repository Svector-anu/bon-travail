import { handle, json, requireAgent } from '@/server/http'
import { bugsForReproduction } from '@/server/queries'

export const dynamic = 'force-dynamic'

/** Aeon reads the bug reports that still want a reproducing test. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAgent(request)
    return json({ bugs: await bugsForReproduction() })
  })
}
