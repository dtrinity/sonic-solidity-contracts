# RewardClaimable Vaults – Design Notes

_Last updated: 2025-10-18_

## Overview

Contracts under `contracts/vaults/rewards_claimable/` implement reusable reward
management primitives for the Sonic ecosystem. The core abstraction,
`RewardClaimable`, standardises how strategy managers:

- Pull reward tokens from upstream protocols,
- Apply protocol fees,
- Forward net rewards to designated receivers, and
- Expose consistent access-control and configurability.

Strategy-specific managers (e.g. `DStakeRewardManagerDLend`) inherit from this
base to integrate with particular venues such as dLEND.

## Core Components

### RewardClaimable (`RewardClaimable.sol`)
- Ownable / access-controlled base contract.
- Key storage:
  - `treasury`: Address receiving protocol fees.
  - `treasuryFeeBps`: Fee in basis points (capped by `MAX_TREASURY_FEE_BPS`).
  - `exchangeThreshold`: Minimum reward amount required before compounding.
- Events cover configuration changes (`TreasurySet`, `TreasuryFeeSet`,
  `ExchangeThresholdSet`) and reward operations (`RewardCompounded`,
  `RewardClaimed`).
- Access roles:
  - `DEFAULT_ADMIN_ROLE` – Manage treasury, thresholds, and downstream
    dependencies.
  - `REWARDS_MANAGER_ROLE` – Adjust treasury address/fees and operational
    thresholds.
- Abstract hook `_claimRewards(address receiver, address[] calldata rewardTokens)`
  must be implemented by derived contracts to interact with the specific reward
  source.
- Public workflow entry point:
  - `compoundRewards(uint256 amount, address[] calldata rewardTokens, address receiver)`
    (implemented in descendants). Base class provides `_processRewards` helper
    to distribute treasury fee and net rewards after `_claimRewards` returns.

### DStakeRewardManagerDLend (`DStakeRewardManagerDLend.sol`)
- Specialisation targeting dLEND rewards for Static AToken wrappers.
- Dependencies:
  - `IDLendRewardsController` – External reward source (`claimRewardsOnBehalf`).
  - `IDStakeRouterDLend` – Provides conversion adapters and default deposit
    asset metadata.
  - `IDStakeCollateralVault` – Receives compounded deposits (e.g. converts dUSD
    into dSTAKE collateral).
  - `IDStableConversionAdapter` – Adapters registered in the router that pull
    dStable and deposit the appropriate vault asset.
- Additional state:
  - `targetStaticATokenWrapper` – Wrapper address on whose behalf rewards are
    claimed.
  - `dLendAssetToClaimFor` – Underlying aToken generating rewards.
  - `exchangeAsset` – dStable token contributed by callers for compounding.
- Overrides `_claimRewards` to call dLEND’s controller and split fees via
  `_processRewards`.
- Provides `_processExchangeAssetDeposit(amount)` hook to:
  1. Approve the router-selected adapter,
  2. Call `convertToVaultAsset(amount)`,
  3. Reset allowance, ensuring the collateral vault receives converted assets.

## Typical Flow: `compoundRewards`

1. **Caller validation** – Check `amount >= exchangeThreshold`, non-empty
   `rewardTokens`, non-zero `receiver`.
2. **Receive exchange asset** – Transfer `amount` of `exchangeAsset` from caller
   to the manager.
3. **Convert & deposit** – `_processExchangeAssetDeposit` converts the exchange
   asset via router adapter and deposits into the collateral vault.
4. **Claim rewards** – `_claimRewards(receiver, rewardTokens)` pulls token list
   from dLEND `RewardsController`.
5. **Fee distribution** – `_processRewards` applies treasury fee (if any) and
   forwards net amounts to `receiver`.
6. **Emit telemetry** – `RewardCompounded` includes amount compounded, fee
   details, and caller address for monitoring.

## Role & Access Model

| Role | Powers |
| --- | --- |
| `DEFAULT_ADMIN_ROLE` | Update router, rewards controller, static wrapper references; grant/revoke other roles. |
| `REWARDS_MANAGER_ROLE` | Set treasury address, treasury fee bps, exchange thresholds. |
| `owner` (Ownable) | Mirrors admin for backwards compatibility; typically multi-sig. |

Derived contracts may add custom roles if necessary; the base class enforces
non-zero treasury/receiver and fee caps.

## Invariants & Guards

- `treasuryFeeBps` ≤ `MAX_TREASURY_FEE_BPS` (10% by default).
- `compoundRewards` reverts when `rewardTokens` array is empty or `receiver` is
  zero.
- Fee application uses `Math.mulDiv` to floor remainder and ensures the fee is
  withdrawn before net distribution.
- Allowance reset after adapter conversions prevents leftover approvals.
- `exchangeThreshold` stops tiny compounding actions that would be gas
  inefficient.

## Extending to New Reward Sources

1. Inherit from `RewardClaimable`.
2. Store protocol-specific configuration (e.g. reward controller address).
3. Implement `_claimRewards(receiver, rewardTokens)` to pull rewards and return
   the claimed amounts.
4. Optionally override hooks (`_beforeCompound`, `_afterCompound`) to interact
   with other contracts or update accounting.
5. Ensure derived contract is granted `DEFAULT_ADMIN_ROLE` to the necessary
   governance address on deployment.

## Operational Notes

- Monitoring should track `RewardCompounded` events to reconcile treasury fee
  inflows and user rewards.
- Governance must whitelist acceptable `IDStableConversionAdapter` instances in
  the router; malicious adapters could mis-handle the exchange asset.
- Compounding automation should batch reward token lists to avoid excessive
  on-chain loops.

## Change Log

- **2025-10-18:** Initial design document covering `RewardClaimable` base and
  `DStakeRewardManagerDLend` implementation.
