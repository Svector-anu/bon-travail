'use client'

import { motion } from 'motion/react'
import type { ReactNode } from 'react'

/** A section fades in once as it scrolls into view: opacity only, a beat after it enters. */
export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.8, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  )
}
