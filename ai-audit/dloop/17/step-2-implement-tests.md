# Step 2 – Implementation of Tests for Audit Issue #17

## Summary
1. Added Solidity test harness & mocks under `contracts/testing/odos/`:
   • `MockOdosRouterV2.sol` – configurable router stub.  
   • `OdosSwapUtilsHarness.sol` – wrapper for the library call.  
   • Adapter & library harnesses (`TestBuyAdapter.sol`, `TestSellAdapter.sol`, `OdosSwapLogicHarness.sol`) for future extension.
2. Implemented Hardhat test utilities (`test/odos/utils/setup.ts`).
3. Created first test-suite `test/odos/OdosSwapUtils.test.ts`:
   • Happy-path swap validates allowance reset & received output.  
   • Regression case `[NEED-TO-FIX-AUDIT-ISSUE]` ensures revert when `actualReceived < exactOut`.
4. All new tests compile & pass (`make compile` + `npx hardhat test test/odos/OdosSwapUtils.test.ts`).

This provides concrete coverage for the core `OdosSwapUtils` fix described in Hats-Finance audit issue #17.  Additional test files for Buy/Sell adapters & SwapLogic were scaffolded but left for Step 3 (optional) if deeper coverage is required. 