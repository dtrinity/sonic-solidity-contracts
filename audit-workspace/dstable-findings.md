# dStable Security Audit Findings

## Audit Summary
**Module**: dStable  
**Date**: 2025-07-15  
**Auditor**: AI Security Auditor  
**Scope**: Smart contract security review of dStable module contracts

## Executive Summary
This audit covers the dStable decentralized stablecoin system, focusing on critical security vulnerabilities that could lead to loss of funds, protocol insolvency, or system manipulation. The audit identified several high-risk vulnerabilities related to oracle manipulation, access control, and economic invariant violations.

---

## [HIGH-01] Missing Oracle Price Validation Allows Manipulation
**Contract**: CollateralVault.sol, Issuer.sol, Redeemer.sol  
**Function**: Multiple functions using oracle.getAssetPrice()  
**Line**: CollateralVault.sol:160, 175, 254; Issuer.sol:111-114  
**Severity**: High

### Description
The system relies entirely on oracle price feeds without any validation, staleness checks, or manipulation protection. An attacker could exploit this through:
1. Oracle manipulation via flash loans to mint unbacked stablecoins
2. Using stale prices during market volatility
3. Exploiting temporary oracle failures or incorrect prices

### Impact
- Minting of unbacked dStable tokens at manipulated prices
- Draining collateral through redemptions at incorrect valuations
- Breaking the core backing invariant (collateral value >= circulating supply)

### Proof of Concept
```solidity
// Attack scenario:
// 1. Flash loan large amount of collateral token
// 2. Manipulate DEX price that oracle uses
// 3. Call Issuer.issue() with inflated collateral value
// 4. Receive excessive dStable tokens
// 5. Repay flash loan, keep profit in dStable
```

### Recommendation
Implement comprehensive oracle security:
```solidity
function getValidatedPrice(address asset) internal view returns (uint256) {
    uint256 price = oracle.getAssetPrice(asset);
    
    // Check for zero/invalid price
    require(price > 0, "Invalid price");
    
    // Add staleness check if oracle supports timestamps
    // require(block.timestamp - priceTimestamp < MAX_PRICE_AGE, "Stale price");
    
    // Consider adding:
    // - Multi-oracle aggregation
    // - Price deviation checks
    // - Circuit breakers for extreme movements
    
    return price;
}
```

---

## [HIGH-02] Unrestricted Oracle Updates Can Break Protocol Invariants
**Contract**: OracleAware.sol  
**Function**: setOracle(), setBaseCurrencyUnit()  
**Line**: 58-68, 75-79  
**Severity**: High

### Description
The admin can change the oracle and base currency unit at any time without validation. This could:
1. Break price consistency across the protocol
2. Allow switching to a malicious oracle
3. Change base currency unit causing calculation errors

### Impact
- Immediate protocol insolvency if oracle is changed to malicious implementation
- Broken calculations if base currency unit is changed without corresponding updates
- Loss of user funds through incorrect valuations

### Proof of Concept
```solidity
// Admin could:
1. Deploy malicious oracle returning arbitrary prices
2. Call setOracle(maliciousOracle)
3. Mint unlimited dStable or drain all collateral
```

### Recommendation
Add safety checks and timelocks:
```solidity
contract OracleAware {
    uint256 constant ORACLE_UPDATE_DELAY = 2 days;
    address public pendingOracle;
    uint256 public oracleUpdateTime;
    
    function proposeOracle(address newOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Validate oracle interface and sanity check prices
        require(IPriceOracleGetter(newOracle).BASE_CURRENCY_UNIT() == baseCurrencyUnit);
        
        // Test with a known asset
        uint256 testPrice = IPriceOracleGetter(newOracle).getAssetPrice(knownAsset);
        require(testPrice > 0 && testPrice < type(uint256).max / 1e18);
        
        pendingOracle = newOracle;
        oracleUpdateTime = block.timestamp + ORACLE_UPDATE_DELAY;
    }
    
    function executeOracleUpdate() external {
        require(block.timestamp >= oracleUpdateTime);
        require(pendingOracle != address(0));
        oracle = IPriceOracleGetter(pendingOracle);
        pendingOracle = address(0);
    }
}
```

---

## [HIGH-03] Centralization Risk Through Unrestricted Role Management
**Contract**: All contracts  
**Function**: AccessControl role management  
**Severity**: High

### Description
The DEFAULT_ADMIN_ROLE has unrestricted power to:
1. Grant/revoke any role including minting rights
2. Change critical protocol parameters instantly
3. Update oracle and vault addresses
4. Pause the stablecoin

No multi-sig, timelock, or governance controls are enforced.

### Impact
- Single compromised admin key can drain entire protocol
- Rug pull risk through admin actions
- No protection against malicious insiders

### Recommendation
1. Use multi-signature wallets for admin roles
2. Implement timelocks for critical changes
3. Consider renouncing certain admin capabilities after deployment
4. Add role separation - admin shouldn't directly hold operational roles

---

## [MEDIUM-01] Integer Overflow in Profit Calculation Casting
**Contract**: AmoManager.sol  
**Function**: withdrawProfits()  
**Line**: 439-442  
**Severity**: Medium

### Description
The code casts `uint256 takeProfitValueInBase` to `int256` without checking if it exceeds `type(int256).max`. While noted in comments as impractical, this could cause incorrect profit validation.

### Impact
- If profit value exceeds int256 max (~5.8e76), the cast wraps to negative
- This would incorrectly pass the profit sufficiency check
- Could allow withdrawing more than available profits

### Proof of Concept
```solidity
// If takeProfitValueInBase = type(int256).max + 1
// Then int256(takeProfitValueInBase) = type(int256).min (negative)
// The check passes even with insufficient profits
```

### Recommendation
Add explicit overflow check:
```solidity
require(takeProfitValueInBase <= uint256(type(int256).max), "Profit value too large");
if (_availableProfitInBase <= 0 || 
    int256(takeProfitValueInBase) > _availableProfitInBase) {
    revert InsufficientProfits(takeProfitValueInBase, _availableProfitInBase);
}
```

---

## [MEDIUM-02] Missing Slippage Protection in CollateralHolderVault Exchange
**Contract**: CollateralHolderVault.sol  
**Function**: exchangeCollateral()  
**Line**: 51-85  
**Severity**: Medium

### Description
The `exchangeCollateral` function allows COLLATERAL_STRATEGY_ROLE to exchange collateral at oracle prices without slippage protection. If oracle prices diverge from market prices, this could result in value loss.

### Impact
- Strategy role could inadvertently exchange collateral at unfavorable rates
- Value leakage during volatile market conditions
- Potential for sandwich attacks if transactions are visible

### Recommendation
Add minimum output validation:
```solidity
function exchangeCollateral(
    uint256 fromCollateralAmount,
    address fromCollateral,
    uint256 toCollateralAmount,
    address toCollateral,
    uint256 minToCollateralAmount // Add this parameter
) public onlyRole(COLLATERAL_STRATEGY_ROLE) {
    // ... existing checks ...
    require(toCollateralAmount >= minToCollateralAmount, "Slippage too high");
    // ... rest of function ...
}
```

---

## [MEDIUM-03] Potential DoS Through Unbounded Collateral List
**Contract**: CollateralVault.sol  
**Function**: _totalValueOfSupportedCollaterals()  
**Line**: 246-264  
**Severity**: Medium

### Description
The function iterates through all supported collateral types without a gas limit. A malicious admin could add many low-value collateral types to cause out-of-gas errors.

### Impact
- DoS of totalValue() calculations
- Inability to issue or redeem stablecoins
- Protocol freeze if collateral list grows too large

### Recommendation
1. Limit maximum number of supported collaterals
2. Implement pagination for value calculations
3. Consider off-chain aggregation with on-chain verification

---

## [LOW-01] Missing Event Emissions for Critical State Changes
**Contract**: Multiple contracts  
**Severity**: Low

### Description
Several critical state changes don't emit events:
- Oracle price fetches (for monitoring)
- Collateral deposits in some paths
- Role changes beyond initial setup

### Impact
- Reduced transparency and auditability
- Difficulty in tracking protocol state off-chain
- Challenges in building monitoring systems

### Recommendation
Add comprehensive event emissions for all state changes.

---

## [LOW-02] Inefficient Approval Pattern in AmoVault
**Contract**: AmoVault.sol  
**Function**: setAmoManagerApproval()  
**Line**: 94-96  
**Severity**: Low

### Description
The function sets approval to 0 before setting new amount to handle non-standard tokens, but dStable is a standard ERC20 that doesn't require this pattern.

### Impact
- Unnecessary gas consumption
- Two approval events instead of one

### Recommendation
Since dStable is a known standard ERC20, directly set the new approval:
```solidity
function setAmoManagerApproval(uint256 amount) public onlyRole(DEFAULT_ADMIN_ROLE) {
    dstable.approve(address(amoManager), amount);
}
```

---

## Additional Observations

### Economic Considerations
1. **AMO Allocation Tracking**: The complex allocation adjustment logic in AmoManager when moving collateral between vaults could lead to accounting errors under edge cases.

2. **Redemption Fees**: The 5% maximum fee in RedeemerWithFees might not be sufficient during extreme market conditions to prevent bank runs.

3. **First Depositor Attack**: While not directly exploitable in current implementation, the protocol should consider initial deposit minimums.

### Best Practices Not Followed
1. No reentrancy guards on critical minting/burning functions (though current implementation appears safe)
2. No circuit breakers or emergency pause mechanisms for specific operations
3. Missing natspec documentation for some internal functions

## Recommendations Summary

### Immediate Actions Required
1. Implement oracle price validation and staleness checks
2. Add timelocks for critical admin functions
3. Fix integer overflow in profit calculations
4. Add slippage protection to collateral exchanges

### Medium-term Improvements
1. Implement multi-oracle aggregation
2. Add circuit breakers for extreme market conditions
3. Consider gradual decentralization of admin roles
4. Implement comprehensive monitoring and alerting

### Long-term Considerations
1. Full decentralization through governance
2. Formal verification of critical invariants
3. Insurance fund for potential losses
4. Cross-chain oracle security improvements

---

## Conclusion

The dStable system implements a functional stablecoin with AMO mechanisms, but has several critical vulnerabilities that must be addressed before mainnet deployment. The primary concerns are around oracle security, centralization risks, and missing safety checks. With the recommended fixes implemented, the protocol would achieve a significantly improved security posture.