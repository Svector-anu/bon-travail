'use client'

import { useSyncExternalStore } from 'react'

export interface StoredClaim {
  claimId: string
  claimToken: string
  wallet: string
  expiresAt: number
}

const claimKey = (taskId: string) => `proofwork.claim.${taskId}`
const claimListeners = new Set<() => void>()
const claimCache = new Map<string, { raw: string | null; value: StoredClaim | null }>()

function readClaim(taskId: string): StoredClaim | null {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(claimKey(taskId))
  } catch {
    return claimCache.get(taskId)?.value ?? null
  }
  const cached = claimCache.get(taskId)
  if (cached && cached.raw === raw) return cached.value
  let value: StoredClaim | null = null
  try {
    value = raw ? (JSON.parse(raw) as StoredClaim) : null
  } catch {
    value = null
  }
  claimCache.set(taskId, { raw, value })
  return value
}

export function saveClaim(taskId: string, claim: StoredClaim) {
  try {
    window.localStorage.setItem(claimKey(taskId), JSON.stringify(claim))
  } catch {
    claimCache.set(taskId, { raw: JSON.stringify(claim), value: claim })
  }
  for (const l of claimListeners) l()
}

function subscribeClaims(listener: () => void) {
  claimListeners.add(listener)
  return () => claimListeners.delete(listener)
}

export function useStoredClaim(taskId: string): StoredClaim | null {
  return useSyncExternalStore(
    subscribeClaims,
    () => readClaim(taskId),
    () => null,
  )
}

