# dLOOP Vault – High-Level Design

## 1. Purpose & Motivation

dLOOP is a family of leveraged ERC-4626 vaults that allow users to obtain fixed-ratio leveraged exposure to a **collateral asset** (e.g. WETH) while simultaneously minting / borrowing a **debt asset** (e.g. dUSD) from an underlying lending protocol (dLend).  
The strategy repeatedly **supplies** collateral and **borrows** debt such that the vault maintains a target leverage ratio `T` expressed in basis-points (`targetLeverageBps`).  Users only interact with a single ERC-4626 share token while the vault handles the looping logic, risk checks and re-balancing incentives.

Typical use-cases:
* Obtain delta-neutral yield (sell the borrowed stable coins elsewhere).
* Leverage up on a productive collateral token without manually managing positions.

---

## 2. Architectural Overview

```
User ─┬─► DLoopDepositor (flash-loan helper) ─────┐
      │                                           │
      ├─► DLoopIncreaseLeverage (flash-loan) ───┐ │
      │                                         │ │
      ├─► DLoopDecreaseLeverage (flash-loan) ─┐ │ │
      │                                       │ │ │
      ├─► DLoopRedeemer (flash-loan helper) ──┤ │ │
      │                                       ▼ ▼ ▼
      │                                   DLoopCoreBase
      │                                    (ERC-4626)
      │                                         │
      │           ┌── supply / withdraw ────────┘
      │           │
      │       Underlying Lending Pool (dLend)
      │           │  borrow / repay
      │           ▼
      │        Flash-loan lender (ERC-3156) (optional path for helpers)
      ▼
   External DEX (SwappableVault) for debt↔collateral swaps
```

### Components

1. **DLoopCoreBase** (contracts/vaults/dloop/core)
   * ERC-4626 vault that stores collateral tokens and interacts with the lending pool.
   * Keeps the system within `[lowerBoundTargetLeverageBps , upperBoundTargetLeverageBps]`.
   * Exposes public functions
     * `deposit / mint`
     * `withdraw / redeem`
     * `increaseLeverage` – supply more collateral + borrow more debt.
     * `decreaseLeverage` – repay debt + withdraw collateral.
   * Incentivises 3rd-party callers via a **subsidy** (`maxSubsidyBps`) paid out of vault balances whenever a caller helps bring the leverage back to target.
   * Uses numerous invariants & custom errors (e.g. `CollateralLessThanDebt`) to fail-fast.
   * Abstracts protocol-specific calls via **virtual hooks**:
     * `_supplyToPoolImplementation` / `_borrowFromPoolImplementation`
     * `_repayDebtToPoolImplementation` / `_withdrawFromPoolImplementation`
     * `_getAssetPriceFromOracleImplementation`
     * `_getAdditionalRescueTokensImplementation`

2. **Periphery Helpers** (contracts/vaults/dloop/periphery)
   These are thin wrappers that package complex user flows ‑ often using ERC-3156 flash-loans and on-chain swaps via `SwappableVault`.
   * `DLoopDepositorBase` – atomic leveraged deposit.
   * `DLoopIncreaseLeverageBase` – bring vault above current leverage using flash-loaned debt → swap → collateral.
   * `DLoopDecreaseLeverageBase` – symmetric repay path.
   * `DLoopRedeemerBase` – redeem shares & unwind leverage for end-users.

3. **Common Utilities**
   * `SwappableVault` – safe token-swap abstraction (aggregator-agnostic).
   * `RescuableVault` – controlled rescue of misc. tokens while preventing misuse of core assets.
   * `BasisPointConstants` – canonical `1e4` bps math.

---

## 3. Core Mechanics

### 3.1 Leverage Calculation
```
leverageBps = (totalCollateralBase * 1e4) / (totalCollateralBase - totalDebtBase)
```
*Base values* use the oracle price of each asset normalised to the lending pool's base currency (usually USD).
* `targetLeverageBps` ≥ `1e4` (i.e. ≥ 100 %).
* Infinite leverage is encoded as `type(uint256).max` when collateral equals debt.

### 3.2 Deposit & Mint
1. User sends `assets` of collateral.
2. Vault supplies `assets` to pool.
3. Vault borrows `y` debt to keep leverage constant (or reach target when first deposit) using formula:
   `y = x * (T' − 10 000) / T'` where `x` is supplied collateral in base and `T'` is leverage in bps.
4. Borrowed debt is transferred to receiver.
5. Shares representing **unleveraged collateral** are minted (`shares = assets`).

### 3.3 Withdraw & Redeem
1. User specifies `assets` to withdraw or `shares` to redeem.
2. Vault computes debt repayment `y` required to keep leverage unchanged (formula symmetrical to borrow).
3. User must approve/transfer `y` debt tokens to vault.
4. Vault repays and withdraws collateral, then transfers collateral to receiver.

### 3.4 Re-balancing (Increase / Decrease)
*Public helpers* or anyone may call `increaseLeverage / decreaseLeverage` when `isTooImbalanced()` is true.

Subsidy to caller:
```
subsidyBps = min( |currentLeverage − target| * 1e4 / target , maxSubsidyBps )
```
Caller receives the subsidy via extra borrowed debt (increase) or extra collateral withdrawn (decrease).

### 3.5 Bounds & Guards
*Deposits / mints / withdraws* revert when leverage is outside allowed band to prevent adverse selection.
Key guards include:
* `CollateralLessThanDebt`, `TotalCollateralBaseIsZero` – sanity.
* `BALANCE_DIFF_TOLERANCE = 1 wei` when verifying post-pool balances.
* All external mutation functions are `nonReentrant`.

---

## 4. Mathematical Helpers
The core exposes pure helpers used by periphery:
* `getBorrowAmountThatKeepCurrentLeverage()`
* `getRepayAmountThatKeepCurrentLeverage()`
* `getAmountToReachTargetLeverage()` – returns `(tokenAmount, direction)` where `direction`∈{-1,0,1}.

These rely on the algebraic identity:
```
(C+x) / (C+x − D − y) = T   with  y = x*(T-1)/T
```
leading to the closed-form solutions embedded in the contract.

---

## 5. Flash-Loan Assisted Workflows

### 5.1 Depositor
1. Flash-loan debt token `F`.
2. Swap `F` → collateral via `SwappableVault` obtaining `C_f`.
3. Combine with user provided collateral `C_u` to supply.
4. Core `deposit()` mints shares & returns debt `≈ F + fee`.
5. Debt is used to repay flash-loan.

### 5.2 IncreaseLeverage
Similar to Depositor but purpose is to call `increaseLeverage` instead of `deposit`.

### 5.3 DecreaseLeverage & Redeemer
Reverse path – flash-loan collateral to repay debt, withdraw and swap back to collateral etc.

Each helper enforces:
* Minimum receive amounts (slippage).
* Left-over dust handling via `minLeftoverDebtTokenAmount`.
* Restricted rescue list equals to known debt tokens for security.

---

## 6. Administration
*Owner* (multisig) may:
* `setMaxSubsidyBps(uint256)`
* `setLeverageBounds(uint32 lower, uint32 upper)`
* Upgrade derived core implementations (this base is abstract).

No pausing logic exists; rescuable tokens are strictly limited (`getRestrictedRescueTokens`).

---

## 7. Extending to Other Markets
To integrate with a new lending market/oracle pair:
1. Inherit from `DLoopCoreBase` and implement the five virtual hooks.
2. Deploy periphery helpers pointing to the new core vault & flash-lender of choice.

---

## 8. Risks & Mitigations
* **Oracle Manipulation** – relies on Chainlink / dLend oracle; price=0 guard.
* **Liquidation Risk** – bounds keep leverage below protocol's `baseLTVAsCollateral`.
* **Flash-Loan Atomicity** – all helper flows revert if any step fails ensuring no half-executed states.
* **Re-entrancy** – `nonReentrant` guards.
* **Slippage** – user specified minima.

---

## 9. Glossary
* **Collateral Token (C)** – Asset supplied to lending pool.
* **Debt Token (D)** – Asset borrowed from lending pool.
* **Base Currency** – Common denomination used by oracle (usually USD).
* **Leverage (L)** – `C / (C − D)`.
* **Subsidy** – Bonus paid to caller bringing leverage back to target.
* **Flash Lender** – ERC-3156 compliant contract supplying 0-interest intra-tx liquidity.

---

_This document is a concise overview; for exact invariants and revert reasons refer to the source code comments in each contract._ 