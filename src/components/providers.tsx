'use client'

import type { ReactNode } from 'react'
import { LocalIdentityProvider } from './identity'
import { PrivyIdentityProvider } from './privy-identity'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID

export function Providers({ children }: { children: ReactNode }) {
  return PRIVY_APP_ID ? (
    <PrivyIdentityProvider appId={PRIVY_APP_ID}>{children}</PrivyIdentityProvider>
  ) : (
    <LocalIdentityProvider>{children}</LocalIdentityProvider>
  )
}
