# dStable v2 Design Document

_Last updated: 2025-10-18_

This document captures the current architecture of the dStable v2 subsystem,
covering token contracts, collateral management, issuance/redemption flows, and
algorithmic market operation (AMO) mechanics. It is intended for protocol
engineers, auditors, and operations teams who need a precise reference for how
value moves through the system.

## Scope

- Core stablecoin contracts under `contracts/dstable/`
- Shared primitives used by these contracts (`OracleAware`, `SupportsWithdrawalFee`)
- Accounting token `AmoDebtToken` and AMO orchestration `AmoManagerV2`
- Interfaces with collateral vaults (`CollateralVault`, `CollateralHolderVault`)

Legacy v1 contracts are excluded; the Issuer/Redeemer/AmoManager versions
documented here are the active implementations.

## Terminology

- **dStable / dUSD** – Upgradeable ERC20 stablecoin (18 decimals) minted by
  `IssuerV2` and burnt by `RedeemerV2`.
- **Base currency** – Oracle denomination (usually USD) with unit
  `oracle.BASE_CURRENCY_UNIT()` (1e8 in Sonic deployments).
- **Base value** – Asset value expressed in the base currency unit.
- **AMO** – Algorithmic Market Operation that expands or contracts the supply of
  dStable or reallocates collateral under governance control.
- **Collateral vault** – Contract that custody collateral, supplies valuation
  utilities, and funnels assets between users, AMOs, and protocol treasury.

## Component Overview

```
Users <---> IssuerV2 ----> CollateralVault <---- RedeemerV2 <---- Users
                  |              ^
                  |              |
                  +--> AmoManagerV2 <--> AmoDebtToken
                                   |
                          External AMO venues
```

### ERC20StablecoinUpgradeable (`contracts/dstable/ERC20StablecoinUpgradeable.sol`)
- Proxy-compatible ERC20 with permit, pausing, flash-loan hooks.
- Minting restricted to `MinterRole` assigned to `IssuerV2`.
- Burn callable by `RedeemerV2` (burns from caller) and `AmoManagerV2`.

### OracleAware (`contracts/dstable/OracleAware.sol`)
- Shared base that stores the trusted `IPriceOracleGetter` and the base currency
  unit.
- Provides modifiers to ensure oracle addresses are non-zero.

### CollateralVault (abstract) & CollateralHolderVault
- `CollateralVault` manages supported collateral sets, enforces role-gated
  deposits/withdrawals, and performs oracle conversions (`assetValueFromAmount`,
  `assetAmountFromValue`). Derived contracts must implement `totalValue()`.
- `CollateralHolderVault` is the simple implementation used by dStable:
  - Stores supported collateral balances directly.
  - Adds `exchangeCollateral` helpers so operations can rebalance between assets
    at oracle prices.
  - Exposes `totalValue()` as the summed base value of all supported assets.

### IssuerV2 (`contracts/dstable/IssuerV2.sol`)
- Public minting endpoint for users.
- Key functions:
  - `issue(collateralAmount, collateralAsset, minDStable)` – Deposits supported
    collateral, values it using the oracle, and mints dStable to the caller.
  - `issueUsingExcessCollateral(receiver, amount)` – Governance-controlled mint
    that is only allowed when vault value exceeds circulating supply.
  - `increaseAmoSupply(amount)` – Mints dStable directly to `AmoManagerV2`;
    guarded so circulating supply is unchanged.
- Maintains per-asset mint pause flags and a global pause via OpenZeppelin
  `Pausable`.
- Tracks circulating supply as `totalSupply - amoManager.totalAmoSupply()`.

### RedeemerV2 (`contracts/dstable/RedeemerV2.sol`)
- Public redemption endpoint with configurable fees.
- Key functions:
  - `redeem(dstableAmount, collateralAsset, minNetCollateral)` – Burns dStable
    from caller, withdraws collateral from the vault, and sends fee to
    `feeReceiver`.
  - `redeemAsProtocol(...)` – Governance-only wrapper without fees (used for
    treasury balancing).
- Fee structure:
  - Default fee in basis points (max 5%).
  - Optional per-asset override that can be zero even if default is non-zero.
- Per-asset redemption pause flags and global pause via `Pausable`.

### AmoDebtToken (`contracts/dstable/AmoDebtToken.sol`)
- 18-decimal ERC20 receipt that mirrors AMO liabilities.
- Transfers restricted to allowlisted addresses; only `AmoManagerV2` (holder of
  `AMO_MANAGER_ROLE`) may mint/burn.
- Intended to be held by the accounting vault; occasionally withdrawn to the
  manager for burning.

### AmoManagerV2 (`contracts/dstable/AmoManagerV2.sol`)
- Unified controller for two AMO flows:
  1. **Stable AMO** – Mints/burns dStable against AMO wallets while minting/burning
     an equal base value of debt tokens in the vault.
  2. **Collateral AMO** – Withdraws collateral to AMO wallets while minting
     matching debt tokens, and repays by returning collateral and burning debt.
- Enforces invariants:
  - Supply changes must match between dStable and debt token up to `tolerance`.
  - Vault total value cannot fall by more than `tolerance` during borrow/repay.
  - Peg guard ensures oracle prices for dStable and debt token remain within
    `pegDeviationBps` before operations execute.
- Roles:
  - `AMO_INCREASE_ROLE` – Borrow collateral / mint dStable.
  - `AMO_DECREASE_ROLE` – Repay collateral / burn dStable.
  - `DEFAULT_ADMIN_ROLE` – Manage wallets, tolerance, peg guard settings, and
    vault address.

## Value Conversions

| Conversion | Function | Formula |
| --- | --- | --- |
| Collateral → base | `CollateralVault.assetValueFromAmount` | `price * amount / 10^decimals` |
| Base → collateral | `CollateralVault.assetAmountFromValue` | `baseValue * 10^decimals / price` |
| Base → dStable | `IssuerV2.baseValueToDstableAmount` | `baseValue * 10^dStableDecimals / baseUnit` |
| dStable → base | `AmoManagerV2.dstableAmountToBaseValue` | `amount * baseUnit / 10^dStableDecimals` |
| Base → debt token | `AmoManagerV2.baseToDebtUnits` | `baseValue * 10^debtDecimals / baseUnit` |

All conversions use `Math.mulDiv`, flooring fractional remainders; any dust stays
in the protocol’s favour.

## Core Flows

### 1. User Mint
1. Caller invokes `IssuerV2.issue`.
2. Contract checks global pause, per-asset pause, and that the oracle price is
   available.
3. Collateral is transferred directly to the vault.
4. dStable is minted to the caller. Supply increase equals collateral base value
   floored to the nearest dStable unit.

### 2. User Redeem
1. Caller invokes `RedeemerV2.redeem`.
2. Contract checks global pause, per-asset redemption pause, and collateral
   support.
3. Calculates total collateral output from the oracle, applies fee, and enforces
   `minNetCollateral`.
4. Burns dStable from the caller and asks the vault to transfer net collateral to
   the caller and fee collateral to `feeReceiver`.

### 3. Stable AMO Expansion (`increaseAmoSupply`)
1. Governance (`AMO_INCREASE_ROLE`) chooses an allowlisted wallet and amount.
2. `AmoManagerV2` ensures both dStable and debt token oracles are near peg.
3. Debt tokens are minted to the vault; dStable is minted to the wallet.
4. Post-check ensures supply deltas match within `tolerance`.

### 4. Stable AMO Contraction (`decreaseAmoSupply`)
1. Wallet approves manager to pull dStable.
2. Manager pulls dStable, burns it, withdraws equal debt tokens from the vault,
   and burns them.
3. Post-check ensures burn totals match within `tolerance`.

### 5. Collateral AMO Borrow (`borrowTo`)
1. Manager verifies wallet allowlist, asset support, and peg guard.
2. Records vault value, mints debt tokens matching collateral base value, and
   withdraws collateral to the wallet.
3. Post-check ensures vault value did not fall by more than `tolerance`.

### 6. Collateral AMO Repay (`repayFrom` / `repayWithPermit`)
1. Wallet transfers approved collateral back to the vault (permit variant signs
   allowance first).
2. Manager computes collateral base value at the current oracle price and burns
   matching debt tokens.
3. Post-check ensures vault value stays within `tolerance`. Callers choose the
   collateral amount such that the resulting base value covers the remaining
   debt; any price appreciation is kept by the wallet.

## Access Control Summary

| Role | Assigned By | Responsibilities |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Deployer → governance | Configure vault/oracle addresses, manage roles, set fees, peg guards. |
| `PAUSER_ROLE` (Issuer/Redeemer) | Admin | Emergency pause/unpause per contract. |
| `INCENTIVES_MANAGER_ROLE` (Issuer) | Admin | Mint against excess collateral. |
| `AMO_MANAGER_ROLE` (Issuer) | Admin | Call `increaseAmoSupply`. |
| `REDEMPTION_MANAGER_ROLE` (Redeemer) | Admin | Protocol-only redemptions. |
| `COLLATERAL_*_ROLE` (Vault) | Admin | Add/remove collateral, withdraw or swap assets. |
| `AMO_INCREASE_ROLE` / `AMO_DECREASE_ROLE` (AmoManagerV2) | Admin | Execute AMO operations. |
| `AMO_MANAGER_ROLE` (AmoDebtToken) | Admin (assigned to AmoManagerV2) | Mint/burn debt tokens. |

Operational runbooks should ensure multi-sig controls for admin-level roles and
require explicit role grants for AMO wallets via `setAmoWalletAllowed`.

## Invariants

- **Collateral backing:** `collateralVault.totalValue()` expressed in base units
  must be ≥ dStable circulating base value. Issuer enforces this on
  `issueUsingExcessCollateral`; operations dashboards monitor it continuously.
- **AMO supply neutrality:** `issuer.circulatingDstable()` excludes balances held
  by `AmoManagerV2`, preventing AMO expansion from showing up as circulating
  supply.
- **Debt token parity:** AMO mint/burn operations must adjust `AmoDebtToken`
  supply by the same base value as dStable or collateral movement (enforced via
  invariants in `AmoManagerV2`).
- **Peg guard:** All AMO operations revert if oracle-reported prices for dStable
  or the debt token deviate beyond `pegDeviationBps`.
- **Oracle dependency:** All conversions assume non-zero oracle prices; callers
  should treat zero-valued conversions as failure scenarios (Issuer/Redeemer
  revert when they produce zero mint/redeem amounts).

## Upgrade & Deployment Notes

- All core contracts rely on OpenZeppelin `AccessControl` and `Pausable`.
- `ERC20StablecoinUpgradeable` is proxy-based; Issuer/Redeemer/AmoManagerV2 are
  regular contracts but can be redeployed with governance migrations.
- Collateral must be allowlisted via `CollateralVault.allowCollateral` before it
  can be used for minting or redemption. Removing collateral requires the vault
  to keep at least one asset in the set.
- `AmoDebtToken` requires the accounting vault to be allowlisted before any AMO
  operations; deployments should call `setAllowlisted(vault, true)` and assign
  `AMO_MANAGER_ROLE` to the live `AmoManagerV2`.

## Operational Guidance

- **Monitoring:** Track total vault value, debt token supply, and AMO wallet
  balances. Alerts should fire when peg guard triggers, when tolerance breaches
  occur, or when invariant checks revert unexpectedly.
- **Liquid asset selection:** Governance should prefer high-liquidity collateral
  with tight oracles to minimise slippage and division-by-zero edge cases.
- **AMO repay workflow:** Tooling should calculate the collateral amount needed
  to close a position using current oracle prices (`debtOutstanding * 10^decimals
  / price`), ensuring `maxDebtBurned` bounds are respected.
- **Fee management:** Fee receiver updates are admin-only and must be set to a
  non-zero address. Per-asset fee overrides require toggling
  `isCollateralFeeOverridden[asset]` and setting the override basis points.

## External Dependencies & Assumptions

- Accurate and fresh oracle feeds for every supported collateral, dStable, and
  `AmoDebtToken`.
- Collateral tokens conform to standard ERC20 semantics (no rebasing or
  deflationary transfers). Deviation requires explicit handling.
- AMO venues (DEXs, lending protocols, etc.) are trusted to return funds to the
  AMO wallet on demand; risk management for venue insolvency sits outside this
  contract set.

## Change Log

- **2025-10-18:** Initial creation for dStable v2 rollout. Captures IssuerV2,
  RedeemerV2, AmoManagerV2, and supporting components.

