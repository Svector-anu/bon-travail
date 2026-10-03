import type { ReactNode } from 'react'

/**
 * A button label that rolls on hover: a second copy waits below, blurred,
 * and both slide up together while the blur swaps. The copy is hidden from
 * assistive tech so the label is read once. Styling lives in globals.css.
 */
export function Roll({ children }: { children: ReactNode }) {
  return (
    <span className="roll">
      <span className="roll-a">{children}</span>
      <span className="roll-b" aria-hidden="true">
        {children}
      </span>
    </span>
  )
}
