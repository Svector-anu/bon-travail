import { ArrowRight, ChevronRight, CircleDollarSign, Link2, Timer } from 'lucide-react'
import Link from 'next/link'
import type { TaskView } from '@/domain/views'
import { TASK_STATUS } from '@/lib/format'
import { Ago, Countdown } from './clock'

/** One scannable line of work: status, title, reward, time, chain, id. */
export function TaskRow({ task, featured = false }: { task: TaskView; featured?: boolean }) {
  const status = TASK_STATUS[task.state]
  const settled = task.state === 'PAID' || task.state === 'REFUNDED' || task.state === 'EXPIRED'
  const href = settled ? `/receipt/${task.id}` : `/task/${task.id}`

  return (
    <Link href={href} className={featured ? 'task-row featured' : 'task-row'}>
      <span className={`status ${status.tone}`}>{status.label}</span>
      <span className="id">{task.displayId}</span>
      <h3>Read this Arc transaction</h3>
      {task.state === 'OPEN' && <p className="desc">Reply with the recipient address and the USDC amount.</p>}
      <div className="meta">
        <span>
          <CircleDollarSign size={15} /> {task.reward} USDC
        </span>
        <span>
          <Timer size={15} />
          {task.state === 'OPEN' && (
            <>
              <Countdown to={task.deadlineAt} done="closing" /> left
            </>
          )}
          {task.state === 'CLAIMED' && task.claimExpiresAt && (
            <>
              Lock frees in <Countdown to={task.claimExpiresAt} done="a moment" />
            </>
          )}
          {task.state === 'PAID' && task.settledAt && (
            <>
              Paid <Ago ts={task.settledAt} />
            </>
          )}
          {(task.state === 'REFUNDED' || task.state === 'EXPIRED') && task.settledAt && (
            <>
              Refunded <Ago ts={task.settledAt} />
            </>
          )}
          {['SUBMITTED', 'VERIFYING', 'ACCEPTED', 'REJECTED'].includes(task.state) && <>In progress</>}
        </span>
        <span>
          <Link2 size={15} /> {task.chain}
        </span>
      </div>
      {featured ? (
        <span className="go" aria-hidden>
          <ArrowRight size={16} />
        </span>
      ) : (
        <span className="go quiet" aria-hidden>
          <ChevronRight size={18} />
        </span>
      )}
    </Link>
  )
}
