# Test Plan: Hats Finance Issue #63 Fix - Post-Execution Leverage Check

## Issue Summary

**GitHub Issue**: [#63](https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/63)  
**Pull Request**: [#69](https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/pull/69)

**Problem**: The `increaseLeverage()` and `decreaseLeverage()` functions in `DLoopCoreBase.sol` calculated predicted leverage before executing operations, but did not verify actual leverage after execution. This could lead to over-leverage conditions due to interest accrual and index updates during the transaction.

**Fix**: Moved leverage validation from pre-execution (prediction-based) to post-execution (actual state-based) in both `increaseLeverage()` and `decreaseLeverage()` functions.

## Changes Made

### File: `contracts/vaults/dloop/core/DLoopCoreBase.sol`

1. **In `increaseLeverage()` (lines 1475-1494 → 1506-1514)**:
   - **REMOVED**: Pre-execution leverage calculation and validation
   - **ADDED**: Post-execution leverage validation using `getCurrentLeverageBps()`
   - **New validation**: `newCurrentLeverageBps > targetLeverageBps || newCurrentLeverageBps <= currentLeverageBps`

2. **In `decreaseLeverage()` (lines 1674-1693 → 1630-1638)**:
   - **REMOVED**: Pre-execution leverage calculation and validation  
   - **ADDED**: Post-execution leverage validation using `getCurrentLeverageBps()`
   - **New validation**: `newCurrentLeverageBps < targetLeverageBps || newCurrentLeverageBps >= currentLeverageBps`

3. **Event Removals**:
   - Removed `IncreaseLeverage` and `DecreaseLeverage` events
   - Removed other events like `MaxSubsidyBpsSet` and `LeverageBoundsSet`

## Test Plan

### A. Test File Structure

Create comprehensive tests in: `test/dloop/DLoopCoreMock/leverage-bounds-post-execution.test.ts`

### B. Test Categories

#### 1. **Post-Execution Leverage Validation Tests**

##### 1.1 IncreaseLeverage Post-Execution Checks

**Test**: `should validate leverage after execution in increaseLeverage()`
- Setup vault with initial leverage below target
- Simulate conditions where interest accrual occurs during execution
- Verify that actual leverage is checked post-execution
- Ensure operation succeeds when post-execution leverage is within bounds

**Test**: `should revert when post-execution leverage exceeds target in increaseLeverage()`
- Setup scenario where predicted leverage is within bounds
- Mock interest accrual to cause actual leverage to exceed target
- Verify `IncreaseLeverageOutOfRange` error is thrown with actual leverage values

**Test**: `should revert when post-execution leverage does not increase in increaseLeverage()`
- Setup scenario where operation would not actually increase leverage
- Verify error is thrown when `newCurrentLeverageBps <= currentLeverageBps`

##### 1.2 DecreaseLeverage Post-Execution Checks

**Test**: `should validate leverage after execution in decreaseLeverage()`
- Setup vault with initial leverage above target
- Simulate conditions where interest accrual occurs during execution
- Verify that actual leverage is checked post-execution
- Ensure operation succeeds when post-execution leverage is within bounds

**Test**: `should revert when post-execution leverage falls below target in decreaseLeverage()`
- Setup scenario where predicted leverage is within bounds
- Mock interest accrual to cause actual leverage to fall below target
- Verify `DecreaseLeverageOutOfRange` error is thrown with actual leverage values

**Test**: `should revert when post-execution leverage does not decrease in decreaseLeverage()`
- Setup scenario where operation would not actually decrease leverage
- Verify error is thrown when `newCurrentLeverageBps >= currentLeverageBps`

#### 2. **Interest Accrual Simulation Tests**

These tests specifically reproduce the attack scenario described in the issue.

##### 2.1 High Utilization Pool Scenario

**Test**: `should handle interest accrual in high-utilization pools during increaseLeverage()`
- Setup high utilization lending pool (80%+ utilization)
- Create scenario from issue example:
  - Initial: Collateral $200k, Debt $100k, Leverage 2.0x
  - User supplies $100k collateral, predicts borrowing $150k for 3.0x leverage
  - Simulate interest accrual during transaction execution
  - Verify post-execution check catches over-leverage condition

**Test**: `should handle index updates during leverage operations`
- Mock the lending pool to simulate index updates during supply/borrow operations
- Verify that post-execution checks account for these changes
- Test both increaseLeverage and decreaseLeverage scenarios

##### 2.2 Edge Case Interest Scenarios

**Test**: `should handle compound interest accrual edge cases`
- Test scenarios with various interest rates (1%, 5%, 20% APY)
- Simulate transaction execution time variations
- Verify boundaries are respected regardless of interest timing

**Test**: `should handle negative interest rate scenarios`
- Test with deflationary tokens or negative yield scenarios
- Verify leverage calculations remain accurate

#### 3. **Boundary Condition Tests**

##### 3.1 Leverage Boundary Testing

**Test**: `should handle leverage exactly at target after execution`
- Test scenarios where post-execution leverage equals target exactly
- Verify operations succeed in this case

**Test**: `should handle leverage within 1 basis point of target`
- Test precision around target leverage
- Verify rounding errors don't cause false positives

##### 3.2 Mathematical Precision Tests

**Test**: `should maintain precision in leverage calculations`
- Test with various token decimals (6, 8, 18)
- Test with extreme price ratios (1:1000, 1000:1)
- Verify no precision loss affects validation

#### 4. **Regression Tests**

##### 4.1 Pre-Fix Vulnerability Reproduction

**Test**: `should demonstrate original vulnerability (for documentation)`
- Create a test that would pass with old pre-execution checks
- Show how interest accrual could cause over-leverage
- Mark as documentation of fixed issue

**Test**: `should verify fix prevents over-leverage scenarios`
- Run exact scenario from GitHub issue #63
- Verify the fix prevents the problematic outcome

##### 4.2 Existing Functionality Preservation

**Test**: `should preserve normal operation functionality`
- Verify all existing legitimate operations still work
- Test various price scenarios and leverage ranges
- Ensure no regression in normal use cases

#### 5. **Error Message Validation Tests**

##### 5.1 Error Content Verification

**Test**: `should provide correct error parameters in IncreaseLeverageOutOfRange`
- Verify error includes actual post-execution leverage
- Verify error includes target leverage and current leverage
- Test that error parameters are accurate for debugging

**Test**: `should provide correct error parameters in DecreaseLeverageOutOfRange`
- Same verification for decrease leverage operations

#### 6. **Gas and Performance Tests**

##### 6.1 Gas Impact Analysis

**Test**: `should measure gas impact of post-execution checks`
- Compare gas usage before and after fix
- Verify gas increase is reasonable for added security

**Test**: `should handle multiple sequential operations efficiently`
- Test gas costs for multiple leverage operations in sequence
- Verify no unexpected gas escalation

### C. Implementation Details

#### Test Setup Requirements

```typescript
// Mock interest accrual in lending pool
interface MockLendingPool {
  simulateInterestAccrual(rate: BigNumber, timeElapsed: number): void;
  enableIndexUpdates(enabled: boolean): void;
  setUtilizationRate(rate: BigNumber): void;
}

// Test fixture additions
interface TestFixture {
  mockLendingPool: MockLendingPool;
  originalLeverageCalculation: Function; // For regression testing
}
```

#### Key Test Data

```typescript
// Attack scenario from GitHub issue #63
const ATTACK_SCENARIO = {
  initialCollateral: ethers.utils.parseEther("200000"),
  initialDebt: ethers.utils.parseEther("100000"),
  initialLeverage: 20000, // 2.0x in bps
  newCollateral: ethers.utils.parseEther("100000"),
  predictedBorrow: ethers.utils.parseEther("150000"),
  targetLeverage: 30000, // 3.0x in bps
  interestAccrual: ethers.utils.parseEther("500"), // $500 interest during tx
  expectedFinalDebt: ethers.utils.parseEther("250500"), // 250,500
  actualFinalLeverage: 30303, // ≈3.03x in bps (over target)
};
```

#### Mock Implementation Strategy

1. **Interest Simulation**: Mock lending pool to simulate interest accrual during execution
2. **Index Updates**: Simulate liquidity index changes that occur during supply/borrow
3. **Time Control**: Use Hardhat time manipulation to simulate transaction execution time
4. **State Tracking**: Track leverage before, during prediction, and after execution

### D. Success Criteria

#### Primary Success Criteria
1. ✅ All new post-execution validation tests pass
2. ✅ Original vulnerability scenario is prevented
3. ✅ No regression in existing functionality
4. ✅ Error messages provide accurate debugging information

#### Secondary Success Criteria
1. ✅ Gas increase is minimal (< 10% increase)
2. ✅ Test coverage > 95% for modified functions
3. ✅ Edge cases are handled gracefully
4. ✅ Documentation accurately reflects new behavior

### E. Test Execution Strategy

#### Phase 1: Unit Tests
- Implement all post-execution validation tests
- Verify error conditions and edge cases
- Test mathematical precision and boundaries

#### Phase 2: Integration Tests  
- Test with various lending pool configurations
- Verify interaction with different token types
- Test under various network conditions

#### Phase 3: Regression Testing
- Run full existing test suite
- Verify no functionality regression
- Performance impact analysis

#### Phase 4: Stress Testing
- High-frequency operation testing
- Extreme price scenario testing
- Edge case boundary testing

### F. Implementation Notes for AI Model

1. **File Locations**:
   - Main test file: `test/dloop/DLoopCoreMock/leverage-bounds-post-execution.test.ts`
   - Fixture updates: `test/dloop/DLoopCoreMock/fixture.ts`
   - Mock contracts: Create new mocks as needed in `contracts/testing/`

2. **Import Requirements**:
   ```typescript
   import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
   import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
   import { expect } from "chai";
   import { ethers } from "hardhat";
   import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
   import { ONE_BPS_UNIT, ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
   ```

3. **Error Testing Pattern**:
   ```typescript
   await expect(
     dloopMock.connect(user).increaseLeverage(amount, minReceived)
   ).to.be.revertedWithCustomError(dloopMock, "IncreaseLeverageOutOfRange")
     .withArgs(actualLeverage, targetLeverage, currentLeverage);
   ```

4. **Test Structure**: Follow existing patterns in `rebalance-test.ts` for consistency

5. **Mock Strategy**: Extend existing mock functionality rather than creating entirely new mocks where possible

## Timeline

- **Test Implementation**: 2-3 days
- **Test Execution & Debugging**: 1-2 days  
- **Documentation & Review**: 1 day
- **Total Estimated Time**: 4-6 days

---

**This test plan ensures comprehensive coverage of the Hats Finance issue #63 fix while maintaining compatibility with existing test infrastructure.** 