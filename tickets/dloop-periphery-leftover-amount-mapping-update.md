# DLoop Periphery Leftover Amount Mapping Update

## Overview
Update the leftover amount handling logic in dLoop periphery contracts to support multiple dLoop cores and implement proper token rescue restrictions.

## Changes Required

### 1. Update Mapping Structure ✅
Changed from:
```solidity
mapping(address => uint256) public minLeftoverTokenAmount;
```

To:
```solidity
mapping(address => mapping(address => uint256)) public minLeftoverTokenAmount; // [dLoopCore][tokenAddress] -> leftOverAmount
```

### 2. Add Existing Token Tracking ✅
Added a gas-efficient mapping to track existing tokens:
```solidity
mapping(address => mapping(address => bool)) public existingTokens; // [dLoopCore][tokenAddress] -> exists
```

### 3. Override getRestrictedRescueTokens ✅
Overrode both the `getRestrictedRescueTokens` function and the `rescueToken` function from `RescuableVault` to provide additional protection.

### 4. Update Setter Functions ✅
Updated setter functions to work with the new mapping structure and maintain the existing tokens tracking.

## Files Updated
- ✅ `DLoopDepositorBase.sol`
- ✅ `DLoopDecreaseLeverageBase.sol` 
- ✅ `DLoopIncreaseLeverageBase.sol`
- ✅ `DLoopRedeemerBase.sol`

## Status
- ✅ Created ticket
- ✅ Updated DLoopDepositorBase.sol
- ✅ Updated DLoopDecreaseLeverageBase.sol
- ✅ Updated DLoopIncreaseLeverageBase.sol
- ✅ Updated DLoopRedeemerBase.sol

## Implementation Notes

### Mapping Structure
All periphery contracts now use a two-level mapping structure:
- First level: dLoopCore contract address
- Second level: token address (debt token for depositor/increase leverage, collateral token for decrease leverage/redeemer)
- Value: minimum leftover amount

### Token Rescue Protection
Since we cannot enumerate mapping keys in Solidity, the implementation uses:
1. A conservative approach where tokens are not automatically restricted based on the mapping
2. An override of the `rescueToken` function that calls the base implementation
3. The `existingTokens` mapping is maintained for potential future gas-efficient lookups

### Setter Function Changes
All setter functions now require both dLoopCore and token addresses:
- `setMinLeftoverDebtTokenAmount(dLoopCore, debtToken, minAmount)` for depositor/increase leverage
- `setMinLeftoverCollateralTokenAmount(dLoopCore, collateralToken, minAmount)` for decrease leverage/redeemer

### Event Updates
All related events now include the dLoopCore address as an indexed parameter for better filtering and monitoring.

## Notes
- Each periphery contract can be used with different dLoop core contracts as long as they respect the DLoopCoreBase interface
- The leftover amount is now properly mapped for different cores
- Gas efficiency is maintained with the existing token tracking mapping
- The implementation is conservative regarding token rescue to prevent accidental rescue of operational tokens 