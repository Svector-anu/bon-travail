import { ArrowLeft, GitBranch } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { AttemptView, TaskView } from '@/domain/views'
import { AutoRefresh } from '@/components/auto-refresh'
import { ClaimCta } from '@/components/claim-cta'
import { Countdown, LocalTime } from '@/components/clock'
import { CopyButton } from '@/components/copy-button'
import { BugEvidence, EvidenceFailure } from '@/components/evidence'
import { Reveal } from '@/components/reveal'
import { WorkPanel } from '@/components/work-panel'
import { TASK_STATUS, whoMayTake, workTitle } from '@/lib/format'
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
            <div>
              <span>Reward</span>
              <strong>{task.reward} USDC</strong>
            </div>
          </div>
          <TimeFact task={task} />
          <div className="fact">
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
        <div className="detail stage-body work-body">
          <Head task={task} />
          <h1>{workTitle(ci)}</h1>
          <p className="work-where">
            <GitBranch size={14} aria-hidden />
            <a href={ci.repoUrl} target="_blank" rel="noreferrer">
              {ci.repo}
            </a>
            <span>·</span>
            {ci.bug ? (
              <a href={ci.bug.issueUrl} target="_blank" rel="noreferrer">
                bug #{ci.bug.issueNumber}
              </a>
            ) : (
              <>
                {ci.workflowName} › {ci.jobName}
              </>
            )}
          </p>

          <div className="facts">
            <div className="fact">
              <div>
                <span>Reward</span>
                <strong>
                  {task.reward} USDC{ci.bonusUsdc ? ` + ${ci.bonusUsdc} bonus` : ''}
                </strong>
              </div>
            </div>
            <TimeFact task={task} />
            <div className="fact">
              <div>
                <span>Approved</span>
                <strong>{whoMayTake(ci)}</strong>
              </div>
            </div>
          </div>
          <p className="reward-note">
            {task.reward} USDC is held in escrow and paid the moment your fix works.
            {ci.bonusUsdc ? ` The ${ci.bonusUsdc} USDC bonus is sent by the team afterwards, outside escrow.` : ''} Paid on Arc testnet.
          </p>

          <div className="acceptance">
            <span className="label">Done when</span>
            <p>{ci.acceptance}</p>
            <small>
              Your project&apos;s own tests check it.{' '}
              {ci.bug && (
                <>
                  Add <span className="mono">{ci.bug.testPath}</span> exactly as written below.{' '}
                </>
              )}
              Leave{' '}
              {ci.protectedPaths.map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  <span className="mono">{p}</span>
                </span>
              ))}{' '}
              as they are.
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

      {ci.bug ? (
        <section className="work-section">
          <BugEvidence bug={ci.bug} failingOutput={live?.finding?.errorExcerpt} />
        </section>
      ) : (
        live?.finding && (
          <section className="work-section">
            <EvidenceFailure facts={live.finding} />
          </section>
        )
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
