import { shortAddress } from '@/domain/address'
import type { TaskView } from '@/domain/views'
import { AgentStrip } from '@/components/agent-strip'
import { AutoRefresh } from '@/components/auto-refresh'
import { DishGrid, type DishCard } from '@/components/dish-grid'
import { taskMascot } from '@/lib/mascots'
import { agentActivity, homeSnapshot, listTaskViews } from '@/server/queries'

export const dynamic = 'force-dynamic'

const MAX_CARDS = 6

function toCard(task: TaskView): DishCard {
  const base = {
    id: task.id,
    title: task.displayId,
    lines: [`Read tx ${shortAddress(task.txHash)}`, `Earn ${task.reward} USDC`] as [string, string],
    icon: taskMascot(task.id),
  }
  switch (task.state) {
    case 'OPEN':
      return { ...base, href: `/task/${task.id}`, action: 'Select', meta: { label: 'Closes in', countdownTo: task.deadlineAt } }
    case 'CLAIMED':
      return {
        ...base,
        href: `/task/${task.id}`,
        action: 'Watch',
        meta: { label: 'Lock frees in', countdownTo: task.claimExpiresAt ?? task.deadlineAt },
      }
    case 'PAID':
      return {
        ...base,
        href: `/receipt/${task.id}`,
        action: 'Receipt',
        meta: { label: 'Paid to', value: task.claimant ? shortAddress(task.claimant) : '--' },
      }
    case 'REFUNDED':
    case 'EXPIRED':
      return { ...base, href: `/receipt/${task.id}`, action: 'Receipt', meta: { label: 'Status', value: 'Refunded' } }
    default:
      return { ...base, href: `/task/${task.id}`, action: 'Watch', meta: { label: 'Status', value: 'Verifying' } }
  }
}

export default function HomePage() {
  const home = homeSnapshot()
  const { status } = agentActivity(1)
  const live = home.live
  const settled = listTaskViews(MAX_CARDS).filter((t) => !live.some((l) => l.id === t.id))
  const cards = [...live, ...settled].slice(0, MAX_CARDS).map(toCard)
  const selectedId = live.find((t) => t.state === 'OPEN')?.id ?? null

  return (
    <section className="page">
      <AutoRefresh />
      <img className="chef" src="/mascots/chef.png" alt="" />
      <h1 className="script">Pick a Task, Get Paid</h1>
      <p className="lede">An agent posts Arc transaction checks. Answer exactly and it pays you USDC.</p>

      <AgentStrip status={status} />

      {cards.length > 0 ? (
        <DishGrid cards={cards} selectedId={selectedId} />
      ) : (
        <div className="tvl-card">
          <h2 className="ink">No tasks yet</h2>
          <p>The agent posts the first one on its next sweep.</p>
        </div>
      )}

      <div className="tvl-card">
        <h2 className="tnum">{home.paidCount > 0 ? `${home.paidTotal} USDC` : '--'}</h2>
        <p>
          Paid to humans by the agent across {home.paidCount} task{home.paidCount === 1 ? '' : 's'}
          {home.simulatedPayments && <span className="sim">Simulated</span>}
        </p>
      </div>
    </section>
  )
}
