import { ArrowRight, ChevronRight, CircleDollarSign, GitBranch, Link2, Timer } from 'lucide-react'
import Link from 'next/link'
import type { TaskView } from '@/domain/views'
import { TASK_STATUS, whoMayTake, workTitle } from '@/lib/format'
import { Ago, Countdown } from './clock'

/** One scannable line of work: status, title, reward, time, where, id. */
export function TaskRow({ task, featured = false }: { task: TaskView; featured?: boolean }) {
  const status = TASK_STATUS[task.state]
  const settled = task.state === 'PAID' || task.state === 'REFUNDED' || task.state === 'EXPIRED'
  const href = settled ? `/receipt/${task.id}` : `/task/${task.id}`
  const ci = task.ci

  return (
    <Link href={href} className={featured ? 'task-row featured' : 'task-row'}>
      <span className={`status ${status.tone}`}>{ci && task.state === 'OPEN' ? 'Open' : status.label}</span>
      <span className="id">{task.displayId}</span>
      <h3>{ci ? workTitle(ci) : 'Read this Arc transaction'}</h3>
      {task.state === 'OPEN' && (
        <p className="desc">
          {ci ? ci.openToAnyone ? 'Open to anyone on GitHub.' : `Saved for ${whoMayTake(ci)}.` : 'Reply with the recipient address and the USDC amount.'}
        </p>
      )}
      <div className="meta">
        <span>
          <CircleDollarSign size={15} /> {task.reward} USDC{ci?.bonusUsdc ? ` + ${ci.bonusUsdc} bonus` : ''}
        </span>
        <span>
          <Timer size={15} />
          {task.state === 'OPEN' && (
            <>
              <Countdown to={task.deadlineAt} done="closing" /> left
            </>
          )}
          {task.state === 'CLAIMED' &&
            (ci ? (
              <>@{task.claimantHandle} is on it</>
            ) : (
              task.claimExpiresAt && (
                <>
                  Lock frees in <Countdown to={task.claimExpiresAt} done="a moment" />
                </>
              )
            ))}
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
          {['SUBMITTED', 'VERIFYING', 'ACCEPTED', 'REJECTED'].includes(task.state) && <>{ci ? 'Checking the fix' : 'In progress'}</>}
          {(task.state === 'DRAFT' || task.state === 'FUNDED') && <>Setting the money aside</>}
        </span>
        <span>
          {ci ? (
            <>
              <GitBranch size={15} /> {ci.repo}
            </>
          ) : (
            <>
              <Link2 size={15} /> {task.chain} · rail test
            </>
          )}
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
