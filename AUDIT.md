# dLEND Swap Adapter Audit Findings

This document is the single source of truth for issues found during the dLEND swap adapter audit. Each entry must specify severity per the rubric:
- Critical – theft or permanent loss of substantial funds.
- High – temporary freeze or serious degradation of core functionality.
- Medium – governance or operator mistakes that can easily cause damage.
- Low – all other findings, including trust assumptions, best practices, gas, etc.

Please check for duplicates before adding new findings. Record the contract, a concise title, detailed description, reasoning, and reproduction steps for Critical/High.

## Wave 1 Findings

### [Low] Debt swap entrypoints lack reentrancy guard (contracts/dlend/periphery/adapters/odos/OdosDebtSwapAdapter.sol:87, contracts/dlend/periphery/adapters/curve/CurveDebtSwapAdapter.sol:87)
- **Description**: Unlike every other user-facing adapter function, `swapDebt` in both the Odos and Curve debt adapters omits `nonReentrant` despite inheriting `ReentrancyGuard`. Each call delegates credit, kicks off flash loans, and hands control to external routers before final accounting, so a malicious router token hook can reenter `swapDebt` while the first invocation still has delegated credit and fresh aToken permits in place.
- **Impact**: A compromised or griefing router can stack reentrant debt swaps in the same transaction, consuming delegated credit or collateral approvals beyond what the user intended and increasing the surface for hard-to-diagnose failures.
- **Evidence**: See the unguarded definitions at contracts/dlend/periphery/adapters/odos/OdosDebtSwapAdapter.sol:87 and contracts/dlend/periphery/adapters/curve/CurveDebtSwapAdapter.sol:87; compare with other adapter entrypoints that explicitly use `nonReentrant`.

### [High] Flash repay approvals revert after blanket max allowance (contracts/dlend/periphery/adapters/odos/OdosDebtSwapAdapter.sol:52, contracts/dlend/periphery/adapters/odos/OdosDebtSwapAdapterV2.sol:59)
- **Description**: Both Odos debt-swap adapters pre-approve every reserve to the pool with `type(uint256).max` in their constructors, but the flash-loan callback later calls `SafeERC20.safeApprove` with the exact repayment amount (contracts/dlend/periphery/adapters/odos/OdosDebtSwapAdapter.sol:222,256 and contracts/dlend/periphery/adapters/odos/OdosDebtSwapAdapterV2.sol:245-264). OpenZeppelin’s `safeApprove` reverts when changing an allowance from a non-zero value to another non-zero value, so the very first flash-loan execution fails with “SafeERC20: approve from non-zero to non-zero allowance.”
- **Impact**: All Odos-based debt refinance flows (with or without extra collateral) revert inside `executeOperation`, leaving the adapters unusable and preventing users from refinancing through Odos.
- **Evidence**: Trigger `swapDebt` with any parameters that reach the flash callback; once `executeOperation` hits `safeApprove`, the blanket `type(uint256).max` allowance from the constructor causes the call to revert, aborting the flash loan and the overall debt swap.

### [Medium] Extra collateral flash path misses premium (contracts/dlend/periphery/adapters/curve/CurveDebtSwapAdapter.sol:168)
- **Description**: When `extraCollateralAsset` is provided, `_flash` sets `interestRateModes[0] = 0`, meaning the pool will reclaim the flash loan plus premium. The extra-collateral branch of `executeOperation` then supplies the entire borrowed amount, later withdraws exactly `collateralAmount` after pulling the same quantity of aTokens from the user, and only re-approves that principal for repayment (contracts/dlend/periphery/adapters/curve/CurveDebtSwapAdapter.sol:200-217). No step sources the premium, so the pool’s closing transfer of `amount + fee` reverts every time this path is exercised.
- **Impact**: The “extra collateral” option for Curve debt swaps is non-functional, preventing users from executing debt migrations that require temporary collateral top-ups and reducing coverage of the adapter’s advertised feature set.
- **Evidence**: Invoke `swapDebt` with any non-zero `extraCollateralAsset`; the first flash loan succeeds, but the closing transfer fails because only `collateralAmount` is available while the pool attempts to pull `collateralAmount + premium`, causing an `ERC20: transfer amount exceeds balance` revert at settlement.

### [High] Incorrect swap accounting in regular Odos path (contracts/dlend/periphery/adapters/odos/BaseOdosSellAdapterV2.sol:177)
- **Description**: `_executeAdaptiveSwap` relies on `_executeDirectOdosExactInput` to report how many output tokens were obtained, but that helper returns the number of input tokens spent. Downstream callers (e.g., `OdosLiquiditySwapAdapterV2.swapLiquidity`, `OdosWithdrawSwapAdapterV2.withdrawAndSwap`) treat the returned value as received output, so they attempt to supply/transfer more of the destination asset than the contract actually holds.
- **Impact**: Any regular (non-PT) Odos swap in the V2 adapters reverts once it tries to use the overstated output amount, rendering the liquidity/withdraw adapters unusable for ordinary assets. This is a high-severity availability failure across core flows.
- **Evidence**: `_executeDirectOdosExactInput` simply forwards the return value of `OdosSwapUtils.executeSwapOperation`, which is documented and implemented as `actualAmountSpent` (contracts/odos/OdosSwapUtils.sol:30-68). `_executeAdaptiveSwap` returns that value as `amountReceived` and the adapters immediately pass it to `_supply` or `safeTransfer` (e.g., contracts/dlend/periphery/adapters/odos/OdosLiquiditySwapAdapterV2.sol:123, 151). Reproduce by invoking `OdosLiquiditySwapAdapterV2.swapLiquidity` with a standard ERC20→ERC20 route; Odos produces, say, 95 units of the new asset, but the adapter tries to supply the full 100 it withdrew, causing an `ERC20: transfer amount exceeds balance` revert.


## Wave 2 (Invert) Findings

### [High] Curve adapters brick after the first swap because SafeERC20 approvals are never reset (contracts/dlend/periphery/adapters/curve/BaseCurveSellAdapter.sol:78, contracts/dlend/periphery/adapters/curve/BaseCurveBuyAdapter.sol:82)
- **Description**: Every Curve helper (`_sellOnCurve`, `_buyOnCurve`) calls `SafeERC20.safeApprove` on each swap without zeroing the previous router allowance. After the first invocation, the allowance stays non-zero, so the very next swap hits SafeERC20’s “approve from non-zero to non-zero allowance” guard and reverts. All Curve-facing flows delegate to these helpers, so the entire adapter suite becomes single-use.
- **Impact**: All Curve withdraw, liquidity-swap, repay, and debt-swap entrypoints revert on their second invocation, preventing users from performing migrations once the adapter has been exercised. This is a High-severity availability failure that renders Curve integrations unusable in production.
- **Evidence**: `contracts/dlend/periphery/adapters/curve/BaseCurveSellAdapter.sol:62-89` and `contracts/dlend/periphery/adapters/curve/BaseCurveBuyAdapter.sol:69-99` re-approve the router each call, while `contracts/dlend/periphery/treasury/libs/SafeERC20.sol:32-47` forbids updating a non-zero allowance to another non-zero value, causing the revert.
- **Reproduction**:
  1. Execute `CurveWithdrawSwapAdapter.withdrawAndSwap` (or any Curve adapter entrypoint) once; the call succeeds and leaves a non-zero router allowance.
  2. Execute the same function again in a fresh transaction; it reverts with `SafeERC20: approve from non-zero to non-zero allowance`, demonstrating that every subsequent Curve swap fails.

### [Critical] PT exact-output swaps consume the full collateral budget (contracts/dlend/periphery/adapters/odos/SwapExecutorV2.sol:176, contracts/dlend/periphery/adapters/odos/PendleSwapLogic.sol:140)
- **Description**: `SwapExecutorV2.executeSwapExactOutput` forwards the caller’s `maxInputAmount` as the definitive PT amount for every composed path; Pendle-side helpers (`executePTToTargetSwap`, `executeSourceToPTSwap`, `executePTToPTSwap`) then unconditionally swap that full amount. When `OdosRepayAdapterV2.repayWithCollateral` (or its flash-loan branch) invokes `_executeAdaptiveBuy` with the withdrawn collateral as the max spend, the adapters liquidate the entire position even if only a fraction is needed to source `repayAmount`. The excess target tokens never reach the user and remain in the adapter.
- **Impact**: Any borrower repaying PT-backed debt can lose nearly all supplied collateral—everything above the true cost is stuck in the adapter and recoverable by the owner via `rescueTokens`, amounting to a permanent forfeiture of user funds.
- **Evidence**:
  1. `SwapExecutorV2.executeSwapExactOutput` passes `params.maxInputAmount` straight into the Pendle helpers for PT routes (contracts/dlend/periphery/adapters/odos/SwapExecutorV2.sol:176-210).
  2. Those helpers treat the input as an exact spend and route it through Pendle/Odos without refunding unused notional (contracts/dlend/periphery/adapters/odos/PendleSwapLogic.sol:140-185,198-260).
  3. `OdosRepayAdapterV2.repayWithCollateral` sends the full withdrawn collateral (or flash-loaned amount) as `maxAmountToSwap`, so every PT repay overpays and strands the surplus on the adapter (contracts/dlend/periphery/adapters/odos/OdosRepayAdapterV2.sol:73-158).
  4. Stuck balances are claimable by the owner through `BaseOdosSwapAdapter.rescueTokens`, cementing the loss for users (contracts/dlend/periphery/adapters/odos/BaseOdosSwapAdapter.sol:119-125).
  5. Reproduce by configuring a PT->stable composed swap that needs 10 PT to buy 100 USDC, then calling `repayWithCollateral` with `collateralAmount=100 PT`; the adapter swaps all 100 PT, repays only 100 USDC, and traps the extra 900 USDC on the contract.


## Wave 3 (Fan Out) Findings

### [High] Curve repay swaps strand positive slippage (contracts/dlend/periphery/adapters/curve/CurveRepayAdapter.sol:148, contracts/dlend/periphery/adapters/curve/CurveRepayAdapter.sol:203)
- **Description**: Both repay paths call `_buyOnCurve`, which can return more `debtRepayAsset` than the target `repayParams.debtRepayAmount`. The adapter immediately forwards only the requested amount to `POOL.repay` and never refunds the surplus, so every swap that clears above the minimum leaves excess debt tokens sitting on the adapter for the owner to sweep.
- **Impact**: Users forfeit any positive slippage when refinancing through Curve; accumulated debt tokens remain trapped on the adapter and are recoverable by the owner via `rescueTokens`, resulting in a direct user-funds loss.
- **Evidence**: In the flash path, `_buyOnCurve` is invoked in `executeOperation` (contracts/dlend/periphery/adapters/curve/CurveRepayAdapter.sol:148-176) and only `repayParams.debtRepayAmount` is approved and repaid; the same pattern occurs in `_swapAndRepay` for the non-flash route (contracts/dlend/periphery/adapters/curve/CurveRepayAdapter.sol:203-219). After a call with `repayParams.debtRepayAmount` set below the actual output (e.g., by supplying a low `min_dy`), the adapter’s `debtRepayAsset` balance remains positive while the user’s position is already closed, demonstrating the stranded surplus.

### [High] Odos V1 adapters strand leftover source tokens when Odos under-spends (contracts/dlend/periphery/adapters/odos/BaseOdosSellAdapter.sol:62, contracts/dlend/periphery/adapters/odos/OdosRepayAdapter.sol:53, contracts/dlend/periphery/adapters/odos/OdosLiquiditySwapAdapter.sol:168, contracts/dlend/periphery/adapters/odos/OdosWithdrawSwapAdapter.sol:68)
- **Description**: The V1 Odos adapters delegate every sale to `_sellOnOdos`, which approves the router for the full `amountToSwap` but ignores the `actualAmountSpent` that `OdosSwapUtils.executeSwapOperation` returns. Callers such as `swapAndRepay`, `_swapAndDeposit`/`executeOperation`, and `withdrawAndSwap` never reconcile the `assetToSwapFrom` balance afterwards. Whenever Odos manages to hit `minAmountToReceive` while spending less than the amount pulled from the user, the unused tokens stay on the adapter instead of being refunded or re-supplied.
- **Impact**: High – the residual balance accumulates on the adapter and can be swept immediately via `BaseOdosSwapAdapter.rescueTokens`, causing permanent user fund loss even though the swap “succeeds”.
- **Evidence**: `_sellOnOdos` ignores `amountSpent` (`BaseOdosSellAdapter.sol:62-90`), the V1 adapters do not adjust balances (`OdosRepayAdapter.sol:53-92`, `OdosLiquiditySwapAdapter.sol:132-188`, `OdosWithdrawSwapAdapter.sol:68-90`), and the V2 test `test/dlend/adapters/odos/v2/LeftoverCollateralHandling.test.ts` demonstrates Odos routes that spend less than the approved input. Configure Odos to consume only 80% of the input, call any V1 adapter, and observe the unused 20% remaining on the contract before the owner rescues it.


## Validation Notes


