# DLoop Decrease Leverage Tests - Issue #324 Fix Coverage

This directory contains comprehensive tests verifying the fix for **Issue #324: Incorrect Collateral Transfer Logic Allows DoS in DLoopDecreaseLeverageBase.sol**.

## Background

The original vulnerability occurred in `DLoopDecreaseLeverageBase.sol` where:

1. The contract would first transfer ALL remaining collateral tokens to `dLoopCore`
2. Then attempt to transfer the user's entitled collateral to the receiver  
3. This caused a revert since the contract's balance was already depleted

## Fix

The fix ensures correct ordering:

1. **User collateral is transferred FIRST** (line 329 in DLoopDecreaseLeverageBase.sol)
2. **Leftover collateral is transferred AFTER** (line 332-345)

## Test Coverage

### 1. `happy-path.test.ts` - Main Fix Verification

- **Test 1**: `transfers user collateral first, then handles leftovers without reverting`
  - Creates leveraged position that becomes imbalanced (4.6x leverage)
  - Executes decrease leverage operation
  - ✅ **Verifies transaction does NOT revert** (would have failed with old bug)
  - ✅ **Verifies user receives collateral**
  - ✅ **Verifies periphery contract has 0 balance after operation**

- **Test 2**: `emits events in correct order: user transfer happens before leftover transfer`
  - ✅ **Verifies event ordering**: user `Transfer` event occurs before `LeftoverCollateralTokensTransferred`
  - ✅ **Proves the fix works at the event level**

### 2. `zero-leftover.test.ts` - Edge Case: No Leftovers

- Tests scenario where entire collateral balance goes to user (no leftovers)
- ✅ **Verifies no `LeftoverCollateralTokensTransferred` event is emitted**
- ✅ **Verifies transaction succeeds**

### 3. `dust-leftover.test.ts` - Edge Case: Minimal Leftovers  

- Tests scenario with very small leftover amounts (wei-level)
- ✅ **Verifies transaction succeeds even with dust amounts**
- ✅ **Verifies dust is properly transferred to core**

## Key Assertions Proving Issue #324 is Fixed

1. **No Revert**: All `decreaseLeverage()` calls complete successfully
2. **User Receives Tokens**: `userCollateralAfter > userCollateralBefore`  
3. **Clean Final State**: `peripheryCollateralAfter == 0` (no stuck funds)
4. **Correct Event Ordering**: User transfer happens before leftover transfer
5. **Value Preservation**: Total value is conserved across user and core

## Test Execution

```bash
# Run all decrease leverage tests
npx hardhat test test/dloop/DLoopDecreaseLeverageMock/

# Run specific test
npx hardhat test test/dloop/DLoopDecreaseLeverageMock/happy-path.test.ts
```

## Confidence Level

These tests provide **high confidence** that Issue #324 is resolved:

- ✅ Direct reproduction of the vulnerable scenario  
- ✅ Verification that the fix prevents the DoS
- ✅ Edge case coverage (zero and dust leftovers)
- ✅ Event-level verification of correct ordering
- ✅ State invariant preservation

Any regression of this bug would immediately cause these tests to fail.
