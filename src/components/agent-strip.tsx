import Link from 'next/link'
import type { AgentStatusView } from '@/domain/views'
import { Ago, LocalTime } from './clock'

const HEALTH_COPY: Record<AgentStatusView['health'], string> = {
  running: 'Agent is running a sweep right now',
  alive: 'Agent is alive',
  error: 'Agent hit an error on its last run',
  stale: 'Agent has missed its schedule',
  never: 'Agent has not run yet',
}

const SOURCE_COPY: Record<string, string> = {
  aeon: 'Aeon',
  'local-loop': 'local loop',
  manual: 'manual trigger',
  'worker-event': 'worker event',
  'demo-seed': 'demo seed',
}

export function sourceLabel(source: string | null): string {
  return source ? (SOURCE_COPY[source] ?? source) : 'nothing yet'
}

export function AgentStrip({ status }: { status: AgentStatusView }) {
  return (
    <div className="notice">
      <img src="/mascots/farmer.png" alt="" />
      <p>
        <span className={`pulse-dot ${status.health}`} aria-hidden />
        <strong>{HEALTH_COPY[status.health]}</strong>
        {status.lastTickAt !== null && (
          <>
            {'. '}Last sweep <Ago ts={status.lastTickAt} /> via {sourceLabel(status.lastTickSource)}
            {status.nextExpectedAt !== null && status.health !== 'stale' && (
              <>
                , next due around <LocalTime ts={status.nextExpectedAt} />
              </>
            )}
            .
          </>
        )}
      </p>
      <Link className="text-action" href="/agent">
        View activity
      </Link>
    </div>
  )
}

export function healthCopy(health: AgentStatusView['health']): string {
  return HEALTH_COPY[health]
}
