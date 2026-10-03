'use client'

import { motion } from 'motion/react'

const EASE = [0.32, 0.72, 0, 1] as const

/**
 * The moment after a payout lands: a check draws itself, then "Bon travail."
 * Plays once, only when the reward has actually been paid.
 */
export function BonTravail({ amount, to, size = 'lg' }: { amount: string; to: string; size?: 'lg' | 'sm' }) {
  return (
    <div className={`bon-travail ${size}`}>
      <svg viewBox="0 0 52 52" className="bon-check" aria-hidden>
        <motion.circle
          cx="26"
          cy="26"
          r="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: EASE }}
        />
        <motion.path
          d="M15 27 l7.5 7.5 L37 19"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, delay: 0.55, ease: EASE }}
        />
      </svg>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.85, ease: EASE }}
      >
        <p className="bon-word">Bon travail.</p>
        <p className="bon-sub">
          <span className="tnum">{amount} USDC</span> sent to <span className="mono">{to}</span>
        </p>
      </motion.div>
    </div>
  )
}
