import { PrivyClient } from '@privy-io/node'
import { getAddress, isAddress } from 'viem'
import type { Address } from '@/domain/types'

export const PRIVY_ID_TOKEN_HEADER = 'privy-id-token'

export interface VerifiedIdentity {
  /** Stable person id (Privy DID). One answer per person per task. */
  userId: string
  /** Every EVM wallet linked to the person, embedded or external. */
  wallets: Address[]
}

/**
 * Decides who is claiming. With Privy configured, a claim must carry a valid
 * identity token and name one of the signer's own wallets. Without Privy the
 * app runs open (local dev, tests, offline demos): any address may claim.
 */
export interface IdentityVerifier {
  readonly required: boolean
  verify(request: Request): Promise<VerifiedIdentity | null>
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie') ?? ''
  const match = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

export class OpenIdentityVerifier implements IdentityVerifier {
  readonly required = false

  async verify(): Promise<null> {
    return null
  }
}

export class PrivyIdentityVerifier implements IdentityVerifier {
  readonly required = true
  private readonly client: PrivyClient

  constructor(options: { appId: string; appSecret: string; verificationKey?: string }) {
    this.client = new PrivyClient({
      appId: options.appId,
      appSecret: options.appSecret,
      jwtVerificationKey: options.verificationKey,
    })
  }

  async verify(request: Request): Promise<VerifiedIdentity | null> {
    const idToken = request.headers.get(PRIVY_ID_TOKEN_HEADER) ?? readCookie(request, PRIVY_ID_TOKEN_HEADER)
    if (!idToken) return null
    let user
    try {
      user = await this.client.users().get({ id_token: idToken })
    } catch {
      return null
    }
    const wallets = user.linked_accounts
      .flatMap((account) =>
        account.type === 'wallet' && 'chain_type' in account && account.chain_type === 'ethereum' && 'address' in account
          ? [account.address]
          : [],
      )
      .filter((address): address is string => typeof address === 'string' && isAddress(address))
      .map((address) => getAddress(address))
    return { userId: user.id, wallets }
  }
}
