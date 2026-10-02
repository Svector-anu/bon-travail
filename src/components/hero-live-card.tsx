'use client'

import { ArrowUpRight } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import type { AgentHealth } from '@/domain/views'
import { Ago } from './clock'

export interface HeroLiveCardProps {
  health: AgentHealth
  lastRunAt: number | null
  latest: { taskId: string; displayId: string; reward: string; to: string | null; at: number; simulated: boolean } | null
}

const PRESENCE: Record<AgentHealth, string> = {
  running: 'Agent running',
  alive: 'Agent online',
  error: 'Agent needs attention',
  stale: 'Agent offline',
  never: 'Agent not started',
}

/** The one floating element on the page: proof that the loop is running right now. */
export function HeroLiveCard({ health, lastRunAt, latest }: HeroLiveCardProps) {
  return (
    <motion.div
      className="hero-live liquid-glass"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.35, ease: [0.32, 0.72, 0, 1] }}
    >
      <Link href="/agent" className="hero-live-row">
        <span className={`presence-dot ${health}`} aria-hidden />
        <span>
          <strong>{PRESENCE[health]}</strong>
          <small>{lastRunAt !== null ? <>Last run <Ago ts={lastRunAt} /></> : 'Waiting for its first run'}</small>
        </span>
      </Link>
      {latest && (
        <Link href={`/receipt/${latest.taskId}`} className="hero-live-pay">
          <span className="label">Latest payout · {latest.displayId}</span>
          <strong className="tnum">{latest.reward} USDC</strong>
          <small>
            {latest.to ? `to ${latest.to}` : 'refunded'} · <Ago ts={latest.at} />
            {latest.simulated ? ' · simulated' : ''}
          </small>
          <ArrowUpRight size={15} className="hero-live-go" />
        </Link>
      )}
    </motion.div>
  )
}
