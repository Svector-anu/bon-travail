import { ArrowLeft, CircleDollarSign, GitBranch, Link2, ShieldCheck, Timer, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { AttemptView, TaskView } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { ClaimCta } from '@/components/claim-cta'
import { Countdown, LocalTime } from '@/components/clock'
import { CopyButton } from '@/components/copy-button'
import { EvidenceFailure } from '@/components/evidence'
import { Reveal } from '@/components/reveal'
import { WorkPanel } from '@/components/work-panel'
import { TASK_STATUS, whoMayTake } from '@/lib/format'
import { getReceiptView, getTaskDetail, type WorkProgress } from '@/server/queries'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = await getTaskDetail((await params).id)
  return { title: detail ? `${detail.task.displayId}: ${detail.task.reward} USDC` : 'Work not found' }
}

function TimeFact({ task }: { task: TaskView }) {
  const settled = task.state === 'PAID' || task.state === 'REFUNDED'
  return (
    <div className="fact">
      <span className="well">
        <Timer size={20} />
      </span>
      <div>
        <span>{settled ? 'Settled' : 'Time left'}</span>
        <strong className="tnum">
          {settled && task.settledAt ? <LocalTime ts={task.settledAt} /> : <Countdown to={task.deadlineAt} done="closing" />}
        </strong>
      </div>
    </div>
  )
}

function Head({ task }: { task: TaskView }) {
  const status = TASK_STATUS[task.state]
  return (
    <div className="detail-top">
      <Link className="text-link" href="/tasks">
        <ArrowLeft size={14} /> Back to work
      </Link>
      <div>
        <span className="label">{task.displayId}</span>
        <span className={`chip ${status.tone}`}>{task.ci && task.state === 'OPEN' ? 'Open' : status.label}</span>
      </div>
    </div>
  )
}

function RailTest({ task, attempts }: { task: TaskView; attempts: AttemptView[] }) {
  const tx = task.tx!
  return (
    <section className="bleed stage">
      <div className="stage-media" aria-hidden>
        <img src="/scenes/task-stage.jpg" alt="" />
      </div>
      <div className="detail stage-body">
        <Head task={task} />
        <h1>Read this Arc transaction</h1>
        <p>Reply with the recipient address and the USDC amount. This is a rail test of the payment loop.</p>
        <div className="hash-field">
          <a className="mono" href={tx.explorerTxUrl} target="_blank" rel="noreferrer" title="Open in Arcscan">
            {tx.txHash}
          </a>
          <CopyButton value={tx.txHash} label="Copy transaction hash" />
        </div>
        <div className="facts">
          <div className="fact">
            <span className="well">
              <CircleDollarSign size={20} />
            </span>
            <div>
              <span>Reward</span>
              <strong>{task.reward} USDC</strong>
            </div>
          </div>
          <TimeFact task={task} />
          <div className="fact">
            <span className="well">
              <Link2 size={20} />
            </span>
            <div>
              <span>Chain</span>
              <strong>{task.chain}</strong>
            </div>
          </div>
        </div>
        <ClaimCta task={task} attempts={attempts} />
      </div>
    </section>
  )
}

async function WorkPackage({ task, attempts, work }: { task: TaskView; attempts: AttemptView[]; work: WorkProgress }) {
  const ci = task.ci!
  const live = await getReceiptView(task.id)
  return (
    <>
      <section className="bleed stage">
        <div className="stage-media" aria-hidden>
          <img src="/scenes/task-stage.jpg" alt="" />
        </div>
        <div className="detail stage-body work-body">
          <Head task={task} />
          <h1>{task.title}</h1>
          <p className="work-where">
            <GitBranch size={14} aria-hidden />
            <a href={ci.repoUrl} target="_blank" rel="noreferrer">
              {ci.repo}
            </a>
            <span>·</span>
            {ci.workflowName} › {ci.jobName}
          </p>

          <div className="facts">
            <div className="fact">
              <span className="well">
                <CircleDollarSign size={20} />
              </span>
              <div>
                <span>Reward</span>
                <strong>{task.reward} USDC</strong>
              </div>
            </div>
            <TimeFact task={task} />
            <div className="fact">
              <span className="well">
                <Users size={20} />
              </span>
              <div>
                <span>Approved</span>
                <strong>{whoMayTake(ci)}</strong>
              </div>
            </div>
          </div>

          <div className="acceptance">
            <span className="label">
              <ShieldCheck size={13} aria-hidden /> Acceptance condition
            </span>
            <p>{ci.acceptance}</p>
            <small>
              Checked automatically: the project&apos;s &ldquo;{ci.jobName}&rdquo; tests must pass
              {ci.requireMerge ? ` on ${ci.baseBranch} after the fix is merged` : ' on the PR head'}. The PR may not change{' '}
              {ci.protectedPaths.map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  <span className="mono">{p}</span>
                </span>
              ))}
              .
            </small>
          </div>

          <WorkPanel
            task={task}
            attempts={attempts}
            claimedPrUrl={work.claimedPrUrl}
            waitingFor={work.waitingFor}
            lastError={work.lastError}
          />
        </div>
      </section>

      <section className="work-section">
        <span className="label">Scope</span>
        <p className="scope">{ci.scope}</p>
      </section>

      {live?.finding && (
        <section className="work-section">
          <EvidenceFailure facts={live.finding} />
        </section>
      )}
    </>
  )
}

export default async function TaskPage({ params }: Props) {
  const detail = await getTaskDetail((await params).id)
  if (!detail) notFound()
  const { task, attempts, work } = detail
  const settled = task.state === 'PAID' || task.state === 'REFUNDED'

  return (
    <Reveal>
      {!settled && <AutoRefresh everyMs={task.ci ? 8000 : 5000} />}
      {task.ci && work ? <WorkPackage task={task} attempts={attempts} work={work} /> : <RailTest task={task} attempts={attempts} />}
    </Reveal>
  )
}
