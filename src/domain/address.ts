import { getAddress, isAddress } from 'viem'

export type AddressCheck =
  | { ok: true; address: `0x${string}` }
  | { ok: false; reason: string }

/**
 * Canonicalises an EVM address. Hex case carries no meaning except as an
 * EIP-55 checksum, so all-lowercase input is accepted, but any input with
 * uppercase hex must carry a valid checksum. The canonical form is the
 * checksummed address.
 */
export function checkAddress(input: string): AddressCheck {
  const trimmed = input.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return { ok: false, reason: 'not a 0x-prefixed 40-hex-character address' }
  }
  if (!isAddress(trimmed, { strict: true })) {
    return { ok: false, reason: 'mixed-case address has an invalid EIP-55 checksum' }
  }
  return { ok: true, address: getAddress(trimmed) }
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address
}

export function isTxHash(input: string): input is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(input)
}
