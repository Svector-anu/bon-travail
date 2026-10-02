export const USDC_DECIMALS = 6
const MICRO_PER_USDC = 10n ** BigInt(USDC_DECIMALS)
const USDC_AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,6})?$/

/**
 * Parses a human USDC amount ("1", "1.5", "0.050359") into micro-units.
 * Returns null for anything that is not a plain non-negative decimal with at
 * most 6 fractional digits. No rounding, no thousands separators, no units.
 */
export function parseUsdc(input: string): bigint | null {
  const trimmed = input.trim()
  if (!USDC_AMOUNT_PATTERN.test(trimmed)) return null
  const [whole = '0', fraction = ''] = trimmed.split('.')
  return BigInt(whole) * MICRO_PER_USDC + BigInt(fraction.padEnd(USDC_DECIMALS, '0'))
}

export function formatUsdc(micro: bigint): string {
  const negative = micro < 0n
  const abs = negative ? -micro : micro
  const whole = abs / MICRO_PER_USDC
  const fraction = (abs % MICRO_PER_USDC).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  const shown = fraction.length < 2 ? fraction.padEnd(2, '0') : fraction
  return `${negative ? '-' : ''}${whole.toString()}.${shown}`
}

export function usdcFromConfig(value: string, name: string): bigint {
  const micro = parseUsdc(value)
  if (micro === null) throw new Error(`${name} must be a plain USDC amount, got "${value}"`)
  return micro
}
