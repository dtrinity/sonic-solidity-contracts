Goal: Add focused Hardhat tests for periphery and quote helper; mock external dependencies.

Test Scope
- Periphery happy path:
  - Mocks: Flash lender (ERC3156), Odos aggregator (returns success), Core DLend (preview/mint/compoundRewards).
  - Asserts: swap called, shares minted == threshold, reward claim called with correct args, flash repaid, surplus recorded.
- Periphery reverts/guards:
  - `maxDeposit == 0` → revert.
  - Swap failure → revert.
  - Insufficient dUSD to repay → revert.
- Quote helper views:
  - Mocks: Rewards controller, pool, addresses provider.
  - Asserts: values bubble up correctly; error paths for invalid addresses and zero rewards.

Structure
- `test/periphery/compounder-odos.spec.ts`
- `test/quote/reward-helper.spec.ts`

Utilities
- Minimal mock contracts in Solidity or via smock/ethers mocks where suitable.

Acceptance
- `make test` green.
- Tests isolated (no external RPC or APIs).

Quick check
- Run single-file tests to ensure isolation works as intended.

