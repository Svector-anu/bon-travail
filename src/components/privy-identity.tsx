'use client'

import { PrivyProvider, useIdentityToken, usePrivy } from '@privy-io/react-auth'
import type { ReactNode } from 'react'
import { shortAddress } from '@/domain/address'
import { ARC_TESTNET_CHAIN } from '@/lib/arc-chain'
import { IdentityProvider, type Identity } from './identity'

const PRIVY_ID_TOKEN_HEADER = 'privy-id-token'

function PrivyIdentityBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const { identityToken } = useIdentityToken()
  const address = user?.wallet?.address ?? null
  const label =
    (user?.twitter?.username && `@${user.twitter.username}`) ||
    user?.google?.email ||
    user?.email?.address ||
    (address ? shortAddress(address) : null)

  const value: Identity = {
    mode: 'privy',
    ready,
    signedIn: ready && authenticated,
    address,
    label,
    embeddedWallet: user?.wallet?.walletClientType === 'privy',
    signIn: () => login(),
    signOut: () => void logout(),
    authHeaders: async () => {
      const headers: Record<string, string> = {}
      if (identityToken) headers[PRIVY_ID_TOKEN_HEADER] = identityToken
      return headers
    },
  }
  return <IdentityProvider value={value}>{children}</IdentityProvider>
}

export function PrivyIdentityProvider({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'google', 'twitter', 'wallet'],
        appearance: {
          theme: 'light',
          accentColor: '#fafafa',
          logo: '/brand/mark.svg',
          landingHeader: 'Sign in to bon travail',
          loginMessage: 'Earn USDC for answers the chain can check.',
          walletChainType: 'ethereum-only',
          showWalletLoginFirst: false,
        },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: ARC_TESTNET_CHAIN,
        supportedChains: [ARC_TESTNET_CHAIN],
      }}
    >
      <PrivyIdentityBridge>{children}</PrivyIdentityBridge>
    </PrivyProvider>
  )
}
