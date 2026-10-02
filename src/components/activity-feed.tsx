import Link from 'next/link'
import type { AgentRunView } from '@/domain/views'
import { actionLabel, displayIdFromTaskId } from '@/lib/format'
import { sourceLabel } from './agent-strip'
import { LocalTime } from './clock'

const RESULT_PILL: Partial<Record<AgentRunView['result'], { label: string; tone: string }>> = {
  skipped: { label: 'Skipped', tone: '' },
  error: { label: 'Error', tone: 'fail' },
}

export function ActivityFeed({ runs, empty }: { runs: AgentRunView[]; empty: string }) {
  if (runs.length === 0) return <div className="card empty">{empty}</div>
  return (
    <ol className="card feed" style={{ listStyle: 'none', margin: '16px 0 0' }}>
      {runs.map((run) => {
        const pill = RESULT_PILL[run.result]
        return (
          <li key={run.id} className={`feed-item ${run.result}`}>
            <LocalTime ts={run.at} />
            <span className="feed-line">
              {actionLabel(run.action)}
              {run.taskId ? ` ${displayIdFromTaskId(run.taskId)}` : ''}
            </span>
            {pill ? <span className={`pill ${pill.tone}`}>{pill.label}</span> : <span />}
            <span className="feed-sub">
              <span>{run.detail}</span>
              <span>via {sourceLabel(run.source)}</span>
              {run.taskId && <Link href={`/receipt/${run.taskId}`}>Receipt</Link>}
            </span>
            {run.error && <span className="feed-err">{run.error}</span>}
          </li>
        )
      })}
    </ol>
  )
}
