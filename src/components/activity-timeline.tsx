'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import type { AgentRunView } from '@/domain/views'
import { activityHeadline } from '@/lib/format'
import { Ago } from './clock'

const SOURCE: Record<string, string> = {
  aeon: 'Aeon',
  'local-loop': 'local loop',
  manual: 'manual run',
  'worker-event': 'on submission',
  'demo-seed': 'demo seed',
  cron: 'Vercel cron',
  owner: 'engineer',
}

/** The agent's own log. New entries slide in at the top as the loop runs. */
export function ActivityTimeline({ runs }: { runs: AgentRunView[] }) {
  if (runs.length === 0) {
    return <p className="muted" style={{ padding: '18px 0' }}>No activity yet. Start the agent and its runs appear here.</p>
  }
  return (
    <ul className="activity">
      <AnimatePresence initial={false}>
        {runs.map((run, i) => (
          <motion.li
            key={run.id}
            layout
            className={[i === 0 ? 'newest' : '', run.result === 'error' ? 'error' : '', run.result === 'skipped' ? 'skipped' : '']
              .filter(Boolean)
              .join(' ')}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
          >
            <div>
              <strong>{activityHeadline(run.action, run.taskId, run.detail, run.result)}</strong>
              <small>
                <Ago ts={run.at} /> · {SOURCE[run.source] ?? run.source}
                {run.taskId && (
                  <>
                    {' · '}
                    <Link href={`/receipt/${run.taskId}`} style={{ color: 'var(--muted)' }}>
                      receipt
                    </Link>
                  </>
                )}
              </small>
              {run.error && <span className="err">{run.error}</span>}
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}
