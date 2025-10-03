# dLEND Swap Adapter Ecosystem Design

## 1. Scope and Goals
- Provide auditors and automated agents with a concise map of the swap adapter layer that sits between dLEND (Aave v3 fork) and external liquidity sources.
- Focus on contracts under `contracts/dlend/periphery/adapters` that orchestrate collateral, debt, and withdrawal swaps through Odos, Pendle PT routing, and Curve.
- Summarize integration points, control flows, shared assumptions, and security guardrails to speed up threat modelling and testing.

## 2. System Context
### Core Actors
- **dLEND Core** – the `IPool` implementation (`contracts/dlend/core`) that holds user collateral/debt balances, exposes flash loans, and emits reserve metadata via `IPoolAddressesProvider`.
- **Swap Adapters** – ownable stateless periphery contracts that temporarily custody assets, perform swaps, and interact with `POOL` on behalf of users.
- **External Routers** – Odos v2 (`contracts/odos/interface/IOdosRouterV2.sol`), Pendle routers for PT tokens, and Curve `RouterNG` pools.
- **Users** – approve aTokens via permit/signature, trigger swaps, and receive resulting assets.

### High-Level Data Flow
1. User invokes an adapter entrypoint (e.g. `repayWithCollateral`, `swapLiquidity`, `withdrawAndSwap`).
2. Adapter pulls aTokens or debt positions from `POOL` (optionally after verifying permits) via `_pullATokenAndWithdraw`.
3. Adapter executes swap logic against Odos or Curve, optionally running Pendle composed swaps for PT tokens or calling `POOL.flashLoan`.
4. Adapter supplies/repays within dLEND and transfers resulting assets back to the user; flash loans are repaid atomically when used.

## 3. Contract Inventory
### 3.1 Shared Foundations
- `BaseOdosSwapAdapter.sol` & `BaseCurveSwapAdapter.sol` – hold immutable references to `ADDRESSES_PROVIDER` and `POOL`, implement shared helpers (`_pullATokenAndWithdraw`, `_conditionalRenewAllowance`, `_supply`, `rescueTokens`).
- `BaseOdosBuyAdapter.sol`, `BaseOdosSellAdapter.sol` – original Odos helpers for exact output (buy) and exact input (sell) flows.
- `BaseOdosBuyAdapterV2.sol`, `BaseOdosSellAdapterV2.sol` – upgrade of the base layer that adds Pendle PT support, oracle validation (`OracleValidation.sol`), and adaptive routing via `SwapExecutorV2.sol` & `PendleSwapLogic.sol`.
- `BaseCurveBuyAdapter.sol`, `BaseCurveSellAdapter.sol` – Curve equivalents that inherit from the base Curve adapter and encode RouterNG call data.
- `OracleValidation.sol` – enforces 5% oracle-deviation tolerance using `IPriceOracleGetter` from the addresses provider before executing swaps.
- `SwapExecutorV2.sol` – library that inspects swap intent, dispatches to Odos-only or composed Odos+Pendle routines, and normalizes error handling.
- `PendleSwapLogic.sol` – detects PT tokens (via `SY()` probe), executes Pendle legs, and composes multi-hop PT↔ERC20 swaps.
- Common interfaces expose shared structs such as `PermitInput` (`IBaseOdosAdapter.sol`) and custom error surface (`IBaseOdosAdapterV2.sol`).

### 3.2 Odos Adapter Stack (V1)
| Contract | Purpose | Notes |
| --- | --- | --- |
| `OdosLiquiditySwapAdapter.sol` | Swap an existing collateral into a new collateral asset. | Supports optional flash loan; relies on `_sellOnOdos` from `BaseOdosSellAdapter`.
| `OdosDebtSwapAdapter.sol` | Refinance existing debt into a different asset. | Uses exact input flow, repays variable/stable debt on `POOL`.
| `OdosRepayAdapter.sol` | Repay debt using collateral or flash-borrowed collateral. | Employs `_buyOnOdos` logic (exact output) and `POOL.flashLoan` when `withFlashLoan=true`.
| `OdosWithdrawSwapAdapter.sol` | Withdraw collateral, swap it, send proceeds to user. | No Pendle/PT awareness; any leftover collateral is handled locally.

V1 contracts depend solely on Odos and ERC20 assets; PT tokens revert due to missing composed logic.

### 3.3 Odos Adapter Stack (V2 with Pendle PT Support)
| Contract | Purpose | PT-Specific Enhancements |
| --- | --- | --- |
| `OdosLiquiditySwapAdapterV2.sol` | Collateral-to-collateral swaps with PT awareness. | Calls `_executeAdaptiveSwap`, re-supplies leftover collateral, supports Pendle routing for PT legs.
| `OdosDebtSwapAdapterV2.sol` | Debt refinancing with PT detection. | Uses `_executeAdaptiveSwap` for exact input, tracks leftover collateral and raises `LeftoverCollateralAfterSwap` on inconsistencies.
| `OdosRepayAdapterV2.sol` | Repay debt using collateral (with or without flash loan). | `_executeAdaptiveBuy` ensures PT routes; `RepayParamsV2` adds `swapData` (raw Odos or encoded `PTSwapDataV2`) & `allBalanceOffset`.
| `OdosWithdrawSwapAdapterV2.sol` | Withdraw collateral, swap, and remit to user. | Re-supplies leftover original collateral, supports `allBalanceOffset` to target full balances.
| `SwapExecutorV2.sol` & `PendleSwapLogic.sol` | Shared execution path for PT ↔ ERC20 swaps. | Validates `PTSwapDataV2`, performs Pendle->Odos sequences, and emits PT-specific diagnostics.

All V2 adapters subclass the V2 bases, embed oracle validation, and surface PT-aware custom errors for off-chain monitoring.

### 3.4 Curve Adapter Stack
| Contract | Purpose | Integration |
| --- | --- | --- |
| `CurveLiquiditySwapAdapter.sol` | Collateral rotation via Curve RouterNG pools. | Supports flash loans; uses `_sellOnCurve` & `route` arrays to describe pool hops.
| `CurveDebtSwapAdapter.sol` | Debt asset refinancing using Curve liquidity. | Mirrors Odos debt swap but targets Curve router.
| `CurveRepayAdapter.sol` | Repay debt by selling collateral through Curve. | Offers flash-loan path; enforces `minAmountToReceive` for slippage control.
| `CurveWithdrawSwapAdapter.sol` | Withdraw collateral, sell it on Curve, deliver to user. | Optional re-supply of leftovers; uses same base helpers as other Curve adapters.

Curve adapters reuse the same base helper patterns (permit pull, allowance renewal, rescue) but interact with RouterNG pool selectors defined in `interfaces/ICurveRouterNgPoolsOnlyV1.sol`.

### 3.5 Supporting Libraries & Interfaces
- **Odos** – `OdosSwapUtils.sol` centrally encodes calldata for `IOdosRouterV2` and records actual input/output amounts.
- **Pendle** – `PendleSwapUtils.sol` (under `contracts/pendle`) invoked by `PendleSwapLogic` for PT swaps.
- **Flash Loan Integration** – `IAaveFlashLoanReceiver` interface reused by both Odos and Curve adapters to satisfy `POOL.flashLoan` callbacks.
- **Permit Handling** – `PermitInput` struct (EIP-2612 style) allows gasless approval for aTokens (`IERC20WithPermit`).
- **DataTypes** – `DataTypes.ReserveData` from `contracts/dlend/core` used to fetch `aToken`, `variableDebtToken`, and `stableDebtToken` addresses before transfers.

## 4. Execution Flow Patterns
### 4.1 Direct Swap (No Flash Loan)
1. Pull user collateral aTokens (optional permit); withdraw underlying via `_pullATokenAndWithdraw`.
2. Run `_executeAdaptiveSwap` (exact input) or `_executeAdaptiveBuy` (exact output) depending on adapter and seize results.
3. Supply/repay on `POOL` when required, or transfer proceeds back to user.
4. Renew allowances lazily with `_conditionalRenewAllowance` and emit `Bought` event for telemetry.

### 4.2 Flash Loan Assisted Swap
1. Adapter encodes params and calls `POOL.flashLoan` with the collateral asset (`withFlashLoan=true`).
2. Inside `executeOperation`, swap borrowed funds into the target asset (Curve or Odos path).
3. Use resulting asset to supply/repay on `POOL`.
4. Pull the user’s original collateral aTokens to settle flash loan principal + premium.
5. Repay flash loan via renewed allowances and exit atomic transaction.

### 4.3 Pendle PT Composed Swap
1. `SwapExecutorV2` inspects `swapData` to detect PT involvement via `PendleSwapLogic.determineSwapType`.
2. For PT→ERC20: execute Pendle leg to underlying, then Odos leg to target. For ERC20→PT: perform Odos swap into underlying, then Pendle into PT. PT→PT performs one or two stages depending on shared underlying.
3. `PendleSwapLogic.validatePTSwapData` guards malformed calldata; oracle checks run before swaps to bound price deviation.
4. The composed routine enforces expected min/max outputs, reverting with `InsufficientOutputAfterComposedSwap` or `InvalidPTSwapData` on failure.

### 4.4 Debt & Repay Specifics
- `repayAmount` can be recomputed on-chain using `_getDebtRepayAmount` (see `OdosRepayAdapterV2.sol`) to account for interest accrual and `allBalanceOffset` toggles.
- Debt swaps repay the old debt after acquiring the new debt asset, then optionally open new debt by borrowing the target asset to the user.
- Withdraw swaps may re-supply leftover source collateral to avoid stranding funds and ensure accounting parity.

## 5. External Dependencies and Assumptions
- **dLEND Pool** – expected to expose Aave v3-compatible interfaces (`supply`, `withdraw`, `repay`, `flashLoan`). Adapters assume reserves are configured and that aTokens/debt tokens support permit (EIP-2612).
- **Price Feeds** – rely on the pool’s `IPriceOracleGetter` for sanity checks; zero prices cause immediate reverts.
- **Odos Router** – calldata provided by off-chain Odos API. Adapters trust router execution but validate balances before/after to detect underfills.
- **Pendle Router** – swap calldata is sourced from Pendle SDK; adapters require accurate `underlyingAsset` and path data in `PTSwapDataV2`.
- **Curve RouterNG** – expects well-formed `route` and `swapParams` arrays matching pool topology; slippage enforced via min-amount arguments.
- **Access Control** – constructors set ownership to a governance address; only owner can `rescueTokens`. Regular swap methods are public.

## 6. Security Considerations
- **Reentrancy** – state-changing entrypoints use `ReentrancyGuard` (`contracts/dlend/periphery/adapters/curve/...` and Odos V2) to block nested calls.
- **Permit Usage** – if `deadline=0`, adapters skip permit execution to avoid accidental reverts; signatures are optional and validated in-line.
- **Allowance Management** – approvals to `POOL` are granted lazily and renewed to `type(uint256).max` when below required thresholds, reducing repeated `approve` calls while keeping owner-controlled rescue available.
- **Oracle Guards** – 5% deviation window (500 bps) prevents users from intentionally overpaying relative to protocol oracle prices, mitigating griefing and MEV capture.
- **Leftover Handling** – V2 adapters re-supply or revert when leftover collateral is detected, ensuring accounting stays in sync with `POOL` balances.
- **Flash Loan Safety** – callbacks verify `msg.sender` equals `POOL` and `initiator` equals the adapter, preventing arbitrary external calls during flash loan execution.
- **Token Rescue** – `rescueTokens` is owner-only and meant for emergency clean-up; production deployments should gate ownership via protocol governance/multisig.

## 7. Operational Notes
- Constructor loops set perpetual approvals for all listed reserves (`POOL.getReservesList()`); onboarding new reserves post-deployment requires manual approval transactions.
- `REFERRER` codes (distinct per adapter) tag interactions for analytics and rebate schemes inside dLEND.
- Extensive test coverage exists under `test/dlend/adapters/odos/v2` and `test/dlend/adapters/curve` to exercise PT routing, flash loan paths, and leftover handling; auditors may reference these when crafting invariants.
- Deployment scripts under `deploy/16_dlend_odos_adapters_v2/` configure V2 adapters with router addresses and governance ownership.

## 8. Key Data Structures (for quick reference)
```solidity
// IBaseOdosAdapter.sol
struct PermitInput {
    IERC20WithPermit aToken;
    uint256 value;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

// PendleSwapLogic.sol
struct PTSwapDataV2 {
    bool isComposed;
    address underlyingAsset;
    bytes pendleCalldata;
    bytes odosCalldata;
}

// IOdosRepayAdapterV2.sol
struct RepayParamsV2 {
    address collateralAsset;
    uint256 collateralAmount;
    address debtAsset;
    uint256 repayAmount;
    uint256 rateMode;
    bool withFlashLoan;
    address user;
    uint256 minAmountToReceive;
    bytes swapData;
    uint256 allBalanceOffset;
}
```

---
This document should be read alongside the contract sources referenced above to confirm implementation details and validate assumptions during the audit.
