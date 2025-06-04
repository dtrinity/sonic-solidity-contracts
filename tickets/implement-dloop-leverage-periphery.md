# Implement DLoop Leverage Periphery Contracts

## Overview
Implement periphery contracts `DLoopIncreaseLeverageBase.sol` and `DLoopDecreaseLeverageBase.sol` to help users increase/decrease leverage with flashloans, similar to the existing deposit and redeem periphery contracts.

## Understanding of Core Functions

### `increaseLeverage()` in DLoopCoreBase:
1. Validates that current leverage < target leverage
2. Calculates required collateral token amount to reach target leverage
3. Transfers additional collateral token from user (if any)
4. Supplies collateral token to lending pool
5. Borrows debt token (with subsidy bonus)
6. Transfers borrowed debt token to user

### `decreaseLeverage()` in DLoopCoreBase:
1. Validates that current leverage > target leverage
2. Calculates required debt token amount to reach target leverage
3. Transfers additional debt token from user (if any)
4. Repays debt token to lending pool
5. Withdraws collateral token (with subsidy bonus)
6. Transfers withdrawn collateral token to user

## Implementation Plan

### DLoopIncreaseLeverageBase.sol ✅
- Use flashloan to get debt tokens
- Swap debt tokens to collateral tokens
- Call `increaseLeverage()` on core contract
- Use received debt tokens to repay flashloan

### DLoopDecreaseLeverageBase.sol ✅
- Use flashloan to get collateral tokens
- Call `decreaseLeverage()` on core contract  
- Swap received collateral tokens to debt tokens
- Use swapped debt tokens to repay flashloan

## Implementation Details

### Key Features Implemented:
1. **Flash Loan Integration**: Both contracts use IERC3156FlashLender for flash loans
2. **Smart Token Management**: Automatic calculation of required flash loan amounts
3. **Slippage Protection**: `minOutputDebtTokenAmount` and `minOutputCollateralTokenAmount` parameters
4. **Leftover Token Handling**: Configurable minimum amounts to transfer leftover tokens to core contract
5. **Security**: Proper access controls, reentrancy guards, and validation checks
6. **Gas Optimization**: Direct execution when flash loans aren't needed

### Contract Structure:
- Inherits from: `IERC3156FlashBorrower`, `Ownable`, `ReentrancyGuard`, `SwappableVault`, `RescuableVault`
- Uses OpenZeppelin contracts for security and standards compliance
- Implements proper error handling with custom error types
- Emits events for important state changes

### Flash Loan Logic:
- **Increase Leverage**: Flash loan debt tokens → swap to collateral → call increaseLeverage → repay with received debt tokens
- **Decrease Leverage**: Flash loan collateral tokens → swap to debt → call decreaseLeverage → repay with received collateral tokens

## Status
- [x] Implement DLoopIncreaseLeverageBase.sol (463 lines)
- [x] Implement DLoopDecreaseLeverageBase.sol (463 lines)
- [ ] Test implementations
- [ ] Deploy to testnet
- [ ] Code review and audit 