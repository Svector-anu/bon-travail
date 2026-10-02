import type { AgentRunSource } from '@/domain/types'
import { getApp } from '@/server/container'
import { DomainError } from '@/server/errors'
import { handle, json, optionalField, readBody, requireAgent } from '@/server/http'

const CALLABLE_SOURCES: readonly AgentRunSource[] = ['aeon', 'local-loop', 'manual']

/** One autonomous sweep. Aeon calls this on a schedule; see aeon/skills/proofwork-loop. */
export async function POST(request: Request) {
  return handle(async () => {
    requireAgent(request)
    const source = (optionalField(await readBody(request), 'source', 20) ?? 'manual') as AgentRunSource
    if (!CALLABLE_SOURCES.includes(source)) {
      throw new DomainError('BAD_REQUEST', `source must be one of ${CALLABLE_SOURCES.join(', ')}`)
    }
    return json(await getApp().agent.tick(source))
  })
}
