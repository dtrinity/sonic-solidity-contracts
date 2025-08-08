# Step 4 – Implement Fix & Ensure Tests Pass (Iteration-1)

## Fix Implemented
* `contracts/vaults/dloop/periphery/venue/odos/OdosSwapLogic.sol`
  * Surplus refund logic now measures **contract’s** `outputToken` balance before/after swap.
  * Transfers any surplus (`actualReceived – amountOut`) to `receiver` when `receiver != this`.
  * Adds safety revert if `actualReceived < amountOut`.
* Removed duplicate `contracts/mocks/MockERC20.sol` to resolve Hardhat artifact conflict.

## Test Updates
* `test/odos/OdosSwapLogic.refund.test.ts` – expectations updated; surplus refund cases now pass.
* `test/odos/OdosSwapLogic.test.ts` – updated first case to expect surplus refund.
* Removed `.only` flags from adapter surplus tests so full odos suite executes.

## Results (odos test suite)
```bash
npx hardhat test test/odos/**/*.ts
  17 passing ✔ (≈ 6 s)
```
All Odos-related tests are green; no `[NEED-TO-FIX-AUDIT-ISSUE]` failures remain in `OdosSwapLogic`.

## Outstanding Work
* Adapter surplus tests are still tagged `[NEED-TO-FIX-AUDIT-ISSUE]` because adapters keep surplus.
* Broader dLoop / dStake test suites reveal unrelated pending failures (outside audit scope #17/124). These will be addressed separately.

The critical audit vulnerability around surplus refund in `swapExactOutput` is now fixed and verified by passing tests. 