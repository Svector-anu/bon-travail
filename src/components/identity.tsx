'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { shortAddress } from '@/domain/address'
import { connectInjected, disconnectWallet, hasInjectedWallet, setManualAddress, useWallet } from './wallet'

/**
 * Who the visitor is, independent of how they signed in. Privy mode gives a
 * social login with an embedded wallet; local mode (no Privy app id) falls
 * back to a browser wallet or a pasted payout address.
 */
export interface Identity {
  mode: 'privy' | 'local'
  ready: boolean
  signedIn: boolean
  address: string | null
  /** Human label for the header pill: @handle, email, or short address. */
  label: string | null
  /** True when the wallet was created for the user at sign-in. */
  embeddedWallet: boolean
  signIn: () => void
  signOut: () => void
  /** Headers that prove identity to the API on claim. */
  authHeaders: () => Promise<Record<string, string>>
  /** Local mode only: use a pasted address as the payout wallet. */
  rememberPayoutAddress?: (address: string) => void
}

const IdentityContext = createContext<Identity | null>(null)

export function IdentityProvider({ value, children }: { value: Identity; children: ReactNode }) {
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

export function useIdentity(): Identity {
  const identity = useContext(IdentityContext)
  if (!identity) throw new Error('useIdentity must be used inside an identity provider')
  return identity
}

export function LocalIdentityProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet()
  const value: Identity = {
    mode: 'local',
    ready: true,
    signedIn: wallet !== null,
    address: wallet?.address ?? null,
    label: wallet ? shortAddress(wallet.address) : null,
    embeddedWallet: false,
    signIn: () => {
      if (hasInjectedWallet()) void connectInjected().catch(() => undefined)
    },
    signOut: disconnectWallet,
    authHeaders: async () => ({}),
    rememberPayoutAddress: (address) => setManualAddress(address),
  }
  return <IdentityProvider value={value}>{children}</IdentityProvider>
}
