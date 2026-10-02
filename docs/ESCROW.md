# ProofworkEscrow

Written, tested (33 Foundry tests) and deployed by **Arc Studio**, driven by
the **Aeon `arc-studio` skill** (`aeon/skills/arc-studio`, prompt in
`aeon/arc-studio/escrow.prompt.md`, run with `npm run arc:escrow`).

| | |
|---|---|
| Network | Arc Testnet (5042002) |
| Address | `0xe8165f9eba6f2e26b552146506abd5df05ae4dd8` |
| Deploy tx | `0xa2adc7085d7ee53ba5d802139ff788bca295145913dd9d863da7e81cf2004529` |
| USDC | `0x3600000000000000000000000000000000000000` |
| Operator and owner | `0x9082B61383869092BD127E68603c110153BDe898` (testnet-only wallet in `.env.local`) |
| Max reward | 1.00 USDC |
| Arc Studio app | https://studio.arc.io/app/d6332e36-f2be-42a1-b757-7f879e80cf09 |

Verified independently after deploy: bytecode present, `operator()`, `owner()`,
`usdc()` and `maxReward()` read back as above, deploy transaction succeeded.

Source: `contracts/ProofworkEscrow.sol`, tests: `contracts/test/ProofworkEscrow.t.sol`.

## Rules

- `fund`, `release`, `refund` are operator-only. A task goes None to Funded to
  exactly one of Released or Refunded; anything after settlement reverts.
- Refunds only after the on-chain deadline and always to the original funder.
- Pause stops new funding only; it can never trap escrowed rewards.
- Ownership is two-step and cannot be renounced.

## Turning it on

1. Fund the operator address with testnet USDC (faucet.circle.com, Arc Testnet).
2. In `.env.local`: `PAYMENT_PROVIDER=arc-escrow` (ARC_ESCROW_ADDRESS is already set).
3. Restart `npm run dev` and `npm run agent:loop`. The first funding also sends a
   USDC approval to the escrow, capped at `MAX_OUTSTANDING_ESCROW_USDC`.
