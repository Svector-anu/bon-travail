'use client'

import { motion } from 'motion/react'
import type { ReactNode } from 'react'

/** Page enter: one short fade and lift, nothing else moves on its own. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** Lets list items arrive in order so new work visibly appears. */
export function RevealItem({ children, index, className }: { children: ReactNode; index: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index, 8) * 0.05, ease: [0.32, 0.72, 0, 1] }}
    >
      {children}
    </motion.div>
  )
}
