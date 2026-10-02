type Row = Record<string, unknown>

export function str(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new TypeError(`column ${key}: expected text, got ${typeof value}`)
  return value
}

export function optStr(row: Row, key: string): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  return str(row, key)
}

export function num(row: Row, key: string): number {
  const value = row[key]
  if (typeof value === 'bigint') return Number(value)
  if (typeof value !== 'number') throw new TypeError(`column ${key}: expected integer, got ${typeof value}`)
  return value
}

export function optNum(row: Row, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  return num(row, key)
}

/** JSON with bigint support: bigints are written as {"$bigint":"123"}. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v))
}

export function fromJson<T>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v && typeof v === 'object' && '$bigint' in v && typeof v.$bigint === 'string') return BigInt(v.$bigint)
    return v
  }) as T
}
