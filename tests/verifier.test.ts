import { describe, expect, it } from 'vitest'
import { parseUsdc, formatUsdc } from '@/domain/money'
import { ARC_USDC_ADDRESS, TRANSFER_TOPIC, extractTransfer } from '@/server/chain/arc'
import { TxFactVerifier } from '@/server/verification/tx-fact-verifier'
import { VerificationUnavailableError } from '@/server/verification/verifier'
import { FIXTURE, SwitchableChain, correctAnswer, makeApp, openTask } from './helpers'

async function setup() {
  const chain = new SwitchableChain()
  const app = makeApp({ chain })
  const task = await openTask(app)
  return { app, chain, task, verifier: new TxFactVerifier(chain, app.clock) }
}

describe('TxFactVerifier', () => {
  it('passes an exact recipient and amount', async () => {
    // #given
    const { task, verifier } = await setup()
    // #when
    const result = await verifier.verify(task, correctAnswer())
    // #then
    expect(result.valid).toBe(true)
    expect(result.code).toBe('MATCH')
    expect(result.fields.every((f) => f.match)).toBe(true)
    expect(result.chainBlock).toBe(FIXTURE.blockNumber.toString())
  })

  it('accepts a lowercase address, which is the same address, not a fuzzy match', async () => {
    // #given
    const { task, verifier } = await setup()
    // #when
    const result = await verifier.verify(task, { recipient: FIXTURE.recipient.toLowerCase(), amount: correctAnswer().amount })
    // #then
    expect(result.valid).toBe(true)
  })

  it('compares amounts as exact micro-units', () => {
    // #when/#then
    expect(parseUsdc('1.5')).toBe(parseUsdc('1.500000'))
    expect(parseUsdc('1.5000001')).toBeNull()
    expect(parseUsdc('01.5')).toBeNull()
    expect(parseUsdc('1e6')).toBeNull()
    expect(parseUsdc('-1')).toBeNull()
    expect(formatUsdc(1_597_856n)).toBe('1.597856')
    expect(formatUsdc(1_000_000n)).toBe('1.00')
  })

  it('rejects an amount off by one micro-unit and names the field', async () => {
    // #given
    const { task, verifier } = await setup()
    // #when
    const result = await verifier.verify(task, {
      recipient: FIXTURE.recipient,
      amount: formatUsdc(FIXTURE.amountMicro + 1n),
    })
    // #then
    expect(result.valid).toBe(false)
    expect(result.code).toBe('MISMATCH')
    expect(result.reason).toBe('Amount does not match the on-chain transfer.')
    expect(result.fields.find((f) => f.field === 'recipient')?.match).toBe(true)
    expect(result.fields.find((f) => f.field === 'amount')?.match).toBe(false)
  })

  it('rejects the sender address submitted as the recipient', async () => {
    // #given
    const { task, verifier } = await setup()
    // #when
    const result = await verifier.verify(task, { recipient: FIXTURE.from, amount: correctAnswer().amount })
    // #then
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Recipient does not match the on-chain transfer.')
  })

  it('rejects a rounded amount', async () => {
    // #given
    const { task, verifier } = await setup()
    // #when
    const result = await verifier.verify(task, { recipient: FIXTURE.recipient, amount: '1.6' })
    // #then
    expect(result.valid).toBe(false)
  })

  it('flags malformed input instead of guessing', async () => {
    // #given
    const { task, verifier } = await setup()
    // #when
    const result = await verifier.verify(task, { recipient: '0x123', amount: '1,59 USDC' })
    // #then
    expect(result.code).toBe('MALFORMED_SUBMISSION')
    expect(result.valid).toBe(false)
  })

  it('rejects a mixed-case address with a bad checksum', async () => {
    // #given
    const { task, verifier } = await setup()
    const bad = FIXTURE.recipient.slice(0, 2) + FIXTURE.recipient.slice(2).split('').map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')
    // #when
    const result = await verifier.verify(task, { recipient: bad, amount: correctAnswer().amount })
    // #then
    expect(result.code).toBe('MALFORMED_SUBMISSION')
  })

  it('refuses to reach a verdict when the chain is unreachable', async () => {
    // #given an unreachable chain
    const { task, verifier, chain } = await setup()
    chain.down = true
    // #when/#then
    await expect(verifier.verify(task, correctAnswer())).rejects.toBeInstanceOf(VerificationUnavailableError)
  })

  it('refuses to reach a verdict when the chain disagrees with the task snapshot', async () => {
    // #given a drifted snapshot
    const { task, verifier } = await setup()
    const drifted = { ...task, expected: { ...task.expected, amountMicro: task.expected.amountMicro + 1n } }
    // #when/#then
    await expect(verifier.verify(drifted, correctAnswer())).rejects.toBeInstanceOf(VerificationUnavailableError)
  })
})

describe('extractTransfer', () => {
  const pad = (addr: string) => `0x${addr.slice(2).toLowerCase().padStart(64, '0')}` as const
  const log = (to: string, value: bigint) => ({
    address: ARC_USDC_ADDRESS,
    topics: [TRANSFER_TOPIC, pad(FIXTURE.from), pad(to)] as [`0x${string}`, ...`0x${string}`[]],
    data: `0x${value.toString(16).padStart(64, '0')}` as const,
  })
  const tx = { from: FIXTURE.from, to: ARC_USDC_ADDRESS, value: 0n, input: '0xa9059cbb', blockNumber: 1n }

  it('reads the single USDC Transfer log', () => {
    // #when
    const read = extractTransfer(tx, { status: 'success', blockNumber: 1n, logs: [log(FIXTURE.recipient, 1_500_000n)] })
    // #then
    expect(read).toMatchObject({ kind: 'ok', fact: { recipient: FIXTURE.recipient, amountMicro: 1_500_000n } })
  })

  it('marks multi-transfer transactions ambiguous', () => {
    // #when
    const read = extractTransfer(tx, {
      status: 'success',
      blockNumber: 1n,
      logs: [log(FIXTURE.recipient, 1n), log(FIXTURE.from, 2n)],
    })
    // #then
    expect(read.kind).toBe('ambiguous')
  })

  it('marks reverted transactions failed', () => {
    // #when/#then
    expect(extractTransfer(tx, { status: 'reverted', blockNumber: 1n, logs: [] }).kind).toBe('failed_tx')
  })

  it('converts native 18-decimal value transfers to micro-units', () => {
    // #given
    const native = { ...tx, to: FIXTURE.recipient, input: '0x', value: 2_000_000n * 10n ** 12n }
    // #when
    const read = extractTransfer(native, { status: 'success', blockNumber: 1n, logs: [] })
    // #then
    expect(read).toMatchObject({ kind: 'ok', fact: { amountMicro: 2_000_000n, source: 'native-value' } })
  })
})
