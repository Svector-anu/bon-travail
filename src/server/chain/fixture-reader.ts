import type { Address, Hex, TransferFact } from '@/domain/types'
import type { ChainReader, TransferRead } from './chain-reader'

interface FixtureTransfer {
  hash: Hex
  from: Address
  recipient: Address
  amountMicro: bigint
  blockNumber: bigint
}

/**
 * Real Arc Testnet USDC transfers, recorded from https://rpc.testnet.arc.network
 * with ArcRpcChainReader on 2026-10-02. Used for tests and offline demos so the
 * verifier compares against genuine on-chain values without a network call.
 */
export const ARC_TESTNET_FIXTURES: readonly FixtureTransfer[] = [
  {
    hash: '0x344e0288b5de3754f1e0d6be6f4329aae123292bec02f8a87b9033fe7de9a46c',
    from: '0x132aA2068d9245254b0951cfE41604f288b71865',
    recipient: '0xFC836f556fb1e731129DEb21CF0e692fcec1dddf',
    amountMicro: 1_597_856n,
    blockNumber: 65_098_124n,
  },
  {
    hash: '0xaf30db3cfd6e3de3764bf88927513b6d7a8c5817ad9e6cf320de237d0a20eea9',
    from: '0x65494BA20e0Ffe6A34951F47E4d718DE0d448952',
    recipient: '0x8731498FC1b9CFB747e4f89EA92A0b0d86195089',
    amountMicro: 47_522n,
    blockNumber: 65_098_124n,
  },
  {
    hash: '0x197d90199c71a6c5d5933e27ff8632fd9d78f6fb5afe1a900888eca7c74f6a09',
    from: '0x062aD80C7b7BAB8Bfc74119F4CAA2A73269B3c95',
    recipient: '0x6263FfE0D90fc3d03c6e600A19a0Ea2782207655',
    amountMicro: 1_418_016n,
    blockNumber: 65_098_124n,
  },
  {
    hash: '0x72fbbc88e65b9fe1ad0009237c751fb2ec3afdabfff8d74ca326ac98041c334b',
    from: '0x04fC7278139527Efbdc00207c6643749112a82F9',
    recipient: '0xd5F492943C58Bb5e3BfA136B88d7b723FDbf5100',
    amountMicro: 1_832_520n,
    blockNumber: 65_098_124n,
  },
  {
    hash: '0x3210896686f533d766ab323f7a5615108ec75691855f9d908f639c1e4dee46bd',
    from: '0xdc26bADf80A9Ba0BBaB6Cc7CdB4b825d07fF8a88',
    recipient: '0x40893428907662997c88907c41a19B30442B1758',
    amountMicro: 1_477_536n,
    blockNumber: 65_098_124n,
  },
  {
    hash: '0x2901600605f623370d2679874a364332d949d6b21d52712cb8398ecb7165bf37',
    from: '0x46C68C4404Cb714a9e510ee48356Ad9A1Ffb5a08',
    recipient: '0xfBE166C37371AD9FB8B0c2DFBA61864b3A9eEcD1',
    amountMicro: 1_909_373n,
    blockNumber: 65_098_124n,
  },
  {
    hash: '0x80c4c0be0cb34ed3975a290f38da403b622d23ed17ab98621a7d645a434d5a23',
    from: '0xC6fbC1E138efeDD8632c3F9281A2b562A6DF57D8',
    recipient: '0xFABb0e2f955709A795A722736f33eC6AE36De386',
    amountMicro: 74_456n,
    blockNumber: 65_098_124n,
  },
  {
    hash: '0x3ef993f32bc8caea70aa1a65f0e1b2a9ddf143a90f1cbb3ee08d8aedec96e654',
    from: '0xc7812f1485d59B492bfFe3D84ecE454bbc60B952',
    recipient: '0x42A4dEfb95682a3e0B6633A4c3FB95420e0493C3',
    amountMicro: 1_124_840n,
    blockNumber: 65_098_123n,
  },
]

export class FixtureChainReader implements ChainReader {
  readonly chainLabel = 'Arc Testnet'
  readonly explorerUrl: string
  private readonly byHash: Map<string, FixtureTransfer>
  private readonly fixtures: readonly FixtureTransfer[]

  constructor(explorerUrl: string, fixtures: readonly FixtureTransfer[] = ARC_TESTNET_FIXTURES) {
    this.explorerUrl = explorerUrl
    this.fixtures = fixtures
    this.byHash = new Map(fixtures.map((f) => [f.hash.toLowerCase(), f]))
  }

  async readTransfer(txHash: Hex): Promise<TransferRead> {
    const fixture = this.byHash.get(txHash.toLowerCase())
    if (!fixture) return { kind: 'not_found' }
    const fact: TransferFact = {
      recipient: fixture.recipient,
      amountMicro: fixture.amountMicro,
      from: fixture.from,
      blockNumber: fixture.blockNumber,
      source: 'erc20-transfer-log',
    }
    return { kind: 'ok', fact }
  }

  async recentTransferCandidates(limit: number): Promise<Hex[]> {
    return this.fixtures.slice(0, limit).map((f) => f.hash)
  }

  /** Just past the newest fixture, so every fixture transfer is in the past. */
  async latestBlockNumber(): Promise<bigint> {
    return this.fixtures.reduce((max, f) => (f.blockNumber > max ? f.blockNumber : max), 0n) + 1n
  }
}
