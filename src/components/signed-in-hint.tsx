'use client'

import { useEffect } from 'react'
import { SIGNED_IN_HINT } from '@/lib/signed-in-hint'

/** Rendered only for a verified engineer, so sessions from before the hint existed pick it up on their next console visit. */
export function SignedInHint({ maxAgeSeconds }: { maxAgeSeconds: number }) {
  useEffect(() => {
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${SIGNED_IN_HINT}=1; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
  }, [maxAgeSeconds])
  return null
}
