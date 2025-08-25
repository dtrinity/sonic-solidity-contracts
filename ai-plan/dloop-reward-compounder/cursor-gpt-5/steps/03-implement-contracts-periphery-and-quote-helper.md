Goal: Implement flashloan-based periphery and reward quoting helper contracts with base/venue abstraction.

Contracts
- Flashloan periphery
  - Base: `RewardCompounderDLendBase.sol`
  - Venue-specific: `RewardCompounderDLendOdos.sol`
  - References: `ai-promt/dloop-reward-compounder/flashloan-reward-compounding-explanation.md`, `bot/dlend-liquidator/contracts/aave-v3/FlashMintLiquidatorAaveBorrowRepayBase.sol`
- Reward quoting helper
  - Base: `RewardQuoteHelperBase.sol`
  - Venue-specific: `RewardQuoteHelperDLend.sol`
  - References: `ai-promt/dloop-reward-compounder/reward-quoting-implementation.md`, `contracts/vaults/dloop/core/venue/dlend/DLoopCoreDLend.sol`

Key Behaviors (periphery)
- Read `exchangeThreshold()`; compute `shares = threshold`.
- Compute `requiredCollateral = core.previewMint(shares)`.
- Execute flashloan/flashmint of dUSD.
- Exact‑out swap dUSD→collateral via Odos (call payload provided externally), with `minOut` guards and slippage bps.
- Mint exactly `shares` to self, receive borrowed dUSD `K`.
- Approve and call `compoundRewards(shares, [dUSD], address(this))`.
- Repay flash amount + fee; keep surplus.
- Guard rails: `maxDeposit(address(this)) > 0`, slippage bounds, reverts propagate.

Key Behaviors (quote helper)
- Surface reward data required for the bot decisioning:
  - `getUserAccruedRewards(user, dUSD)`, `getUserRewardsAllReserves(user, dUSD)`
  - Comprehensive summary and per-asset views
- Aligns with dLEND interfaces and pools; zero external calls in tests (mock the interfaces where needed).

Files
- `contracts/reward/RewardCompounderDLendBase.sol`
- `contracts/reward/RewardCompounderDLendOdos.sol`
- `contracts/reward/RewardQuoteHelperBase.sol`
- `contracts/reward/RewardQuoteHelperDLend.sol`

Acceptance
- Contracts compile; public interfaces documented.
- Venue-specific contract accepts raw aggregator calldata bytes.
- No reliance on root repo paths; only subrepo-local imports.

Quick check
- Draft minimal interfaces for Core, Lender, and Aggregator to enable compilation before wiring full interfaces.
