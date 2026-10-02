'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Re-renders the server components on an interval so the page reflects what
 * the agent did since it loaded. Pauses while the tab is hidden.
 */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, everyMs)
    return () => clearInterval(id)
  }, [router, everyMs])
  return null
}
