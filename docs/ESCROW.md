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

## Payment lifecycle

| Moment | Ledger row | On-chain call |
|---|---|---|
| Engineer approves a work package | `fund` | `fund(taskKey, reward, deadline)` pulls USDC from the operator into escrow |
| GitHub Actions passes the fix | `release` | `release(taskKey, contributorWallet)` |
| Deadline passes without an accepted fix | `refund` | `refund(taskKey)`, only once the chain clock passes the deadline |

`taskKey` is `keccak256("<ESCROW_NAMESPACE>:<taskId>")`. Task ids restart in every
database, so each deployment that shares this contract needs its own
`ESCROW_NAMESPACE`; otherwise two deployments would address the same escrow slot.

Each call is signed once, stored with its hash, then broadcast and confirmed. A
retry rebroadcasts the stored transaction, so a payout can never be sent twice.
The ledger's caps are checked before the row exists; the contract's
`maxReward` is a second limit.

## Reading the contract

The contract is not source-verified on Arcscan (Arc Studio's build settings
could not be reproduced byte for byte), so read it with the ABI in
`contracts/IProofworkEscrow.sol`: `escrows(bytes32)` returns
`(uint256 amount, uint64 deadline, uint8 status)` with status
`0 None, 1 Funded, 2 Released, 3 Refunded`. When an Arc Studio audit was
asked to read the escrows without that ABI, it guessed the key encoding and
the struct and reported every slot empty. Treat a model's read of chain state
as a lead, and confirm it with a direct contract call.

## Turning it on

1. Fund the operator address with testnet USDC (faucet.circle.com, Arc Testnet).
2. Set `PAYMENT_PROVIDER=arc-escrow`, `ARC_ESCROW_ADDRESS`, `ARC_PAYER_PRIVATE_KEY`
   and a unique `ESCROW_NAMESPACE`.
3. The first funding also sends a USDC approval to the escrow, capped at
   `MAX_OUTSTANDING_ESCROW_USDC`.

## Launch review (Arc Studio, October 2026)

Arc Studio reviewed the deployed contract from its bytecode, since the source is not verified on Arcscan. Each finding was then checked against `contracts/ProofworkEscrow.sol` and the live contract:

| Finding | Verdict |
|---|---|
| Owner and operator are the same key | **True.** Both are `0x9082…e898`. Acceptable on testnet; before mainnet the owner (who can change the operator and pause) moves to a separate cold key or multisig. |
| `release` takes the worker as an argument | **True, by design.** Who fixed the work is only known after the claim, so the operator names the worker at release. The server only releases to the claimant its verifier accepted. The exposure of a stolen operator key is capped by `maxReward` per task and `MAX_OUTSTANDING_ESCROW_USDC` in total. |
| `maxReward` is fixed at 1 USDC | **True.** It is `immutable`, so production amounts need a redeploy with a new cap. |
| Refund may go to the caller | **False.** `refund` pays the stored `funder`. |
| Duplicate payout unknown | **Not possible.** `release` and `refund` both require `Status.Funded` and set the final status before transferring. |
| `renounceOwnership` would succeed | **False.** Called from the owner it reverts with `RenounceDisabled()` (`0x89051165`), checked live. From anyone else it reverts with `OwnableUnauthorizedAccount`. |

Before mainnet: verify the source on Arcscan, split owner from operator, and redeploy with the production cap.
