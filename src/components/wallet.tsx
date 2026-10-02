'use client'

import { useSyncExternalStore } from 'react'

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

export interface WalletState {
  address: string
  via: 'injected' | 'manual'
}

const KEY = 'proofwork.wallet'
const listeners = new Set<() => void>()
let cached: { raw: string | null; value: WalletState | null } = { raw: null, value: null }

function read(): WalletState | null {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(KEY)
  } catch {
    return cached.value
  }
  if (raw === cached.raw) return cached.value
  let value: WalletState | null = null
  try {
    value = raw ? (JSON.parse(raw) as WalletState) : null
  } catch {
    value = null
  }
  cached = { raw, value }
  return value
}

function write(value: WalletState | null) {
  try {
    if (value) window.localStorage.setItem(KEY, JSON.stringify(value))
    else window.localStorage.removeItem(KEY)
  } catch {
    cached = { raw: value ? JSON.stringify(value) : null, value }
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => e.key === KEY && listener()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useWallet(): WalletState | null {
  return useSyncExternalStore(subscribe, read, () => null)
}

export function hasInjectedWallet(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum)
}

/** Asks the browser wallet for an account. Throws a readable error. */
export async function connectInjected(): Promise<WalletState> {
  if (!window.ethereum) throw new Error('No browser wallet found. Paste your address instead.')
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
  const address = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null
  if (!address) throw new Error('The wallet did not return an account.')
  const state: WalletState = { address, via: 'injected' }
  write(state)
  return state
}

export function setManualAddress(address: string): WalletState {
  const state: WalletState = { address: address.trim(), via: 'manual' }
  write(state)
  return state
}

export function disconnectWallet() {
  write(null)
}

export function identiconStyle(address: string): { background: string } {
  const h1 = parseInt(address.slice(2, 8), 16) % 360
  const h2 = parseInt(address.slice(-6), 16) % 360
  return {
    background: `radial-gradient(circle at 30% 30%, hsl(${h2} 80% 75%), transparent 45%), conic-gradient(hsl(${h1} 65% 55%), hsl(${h2} 60% 40%), hsl(${h1} 70% 60%))`,
  }
}
