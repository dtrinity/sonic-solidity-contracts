# Oracle Aggregator and dPool Module Security Audit

## Executive Summary

This audit covers the Oracle Aggregator system and dPool module of the dTRINITY protocol. The Oracle Aggregator is critical infrastructure that provides price feeds to all protocol modules, while dPool manages liquidity pool positions through ERC4626 vaults integrated with Curve.

**Severity Classification:**
- 🔴 **Critical**: Can lead to immediate loss of funds or protocol compromise
- 🟠 **High**: Can lead to loss of funds under specific conditions
- 🟡 **Medium**: Can cause protocol malfunction or minor losses
- 🟢 **Low**: Best practice violations or inefficiencies

## Part 1: Oracle Aggregator Findings

### 🔴 Critical: No Validation of Oracle Wrapper BASE_CURRENCY_UNIT Consistency

**Location**: `OracleAggregator.setOracle()` lines 78-93

**Description**: While the aggregator checks that the oracle wrapper's `BASE_CURRENCY_UNIT` matches its own, there's no validation that composite oracles maintain consistent decimal precision when combining prices.

**Impact**: In `API3CompositeWrapperWithThresholding.getPriceInfo()`, the calculation:
```solidity
price = (priceInBase1 * priceInBase2) / BASE_CURRENCY_UNIT;
```
Could lead to incorrect pricing if the two underlying oracles have different decimal precisions before conversion.

**Recommendation**: Add validation in composite wrappers to ensure both underlying oracles have matching `BASE_CURRENCY_UNIT` after conversion.

### 🟠 High: Insufficient Staleness Protection in Oracle Wrappers

**Location**: `BaseAPI3Wrapper.sol` lines 48-51

**Description**: The staleness check uses:
```solidity
isAlive = price > 0 && 
    timestamp + API3_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp;
```

**Issues**:
1. `API3_HEARTBEAT` is hardcoded to 24 hours, which may not match actual oracle update frequencies
2. `heartbeatStaleTimeLimit` (30 minutes) can be changed by `ORACLE_MANAGER_ROLE` without bounds
3. No minimum staleness threshold enforcement

**Impact**: Stale prices could be accepted as valid, leading to incorrect valuations across the protocol.

**Recommendation**: 
- Make heartbeat configurable per oracle feed
- Add bounds checking for `heartbeatStaleTimeLimit`
- Consider implementing a circuit breaker for extended oracle downtime

### 🟠 High: Threshold Manipulation Risk

**Location**: `ThresholdingUtils.sol` and implementations

**Description**: The thresholding mechanism allows arbitrary price fixing when prices exceed a threshold:
```solidity
if (priceInBase > thresholdConfig.lowerThresholdInBase) {
    return thresholdConfig.fixedPriceInBase;
}
```

**Issues**:
1. No validation that `fixedPriceInBase` is reasonable relative to `lowerThresholdInBase`
2. Admin can set thresholds that effectively cap prices at arbitrary levels
3. No events emitted when thresholds are triggered (only when configured)

**Impact**: Malicious or compromised admin could manipulate prices by setting inappropriate thresholds.

**Recommendation**:
- Add validation that `fixedPriceInBase` is within a reasonable range of `lowerThresholdInBase`
- Emit events when thresholds are triggered
- Consider timelock for threshold changes

### 🟡 Medium: HardPegOracleWrapper Lacks Access Control

**Location**: `HardPegOracleWrapper.sol`

**Description**: The hard peg oracle returns a fixed price for any asset without any access control or asset validation.

**Impact**: If mistakenly set as an oracle for a volatile asset, it would return incorrect prices.

**Recommendation**: Add a whitelist of assets that are allowed to use hard peg pricing.

### 🟡 Medium: No Fallback Oracle Mechanism

**Location**: `OracleAggregator.sol`

**Description**: If an oracle fails or returns invalid data, there's no fallback mechanism to alternative price sources.

**Impact**: Protocol components relying on price feeds would halt operations during oracle outages.

**Recommendation**: Implement a fallback oracle system with configurable priority ordering.

### 🟢 Low: Missing Zero Address Validation

**Location**: Multiple oracle wrappers

**Description**: Some oracle wrapper setters don't validate against zero addresses for proxy/feed addresses.

**Recommendation**: Add zero address checks in all administrative functions.

## Part 2: dPool Module Findings

### 🟠 High: LP Token Price Manipulation via Direct Transfers

**Location**: `DPoolVaultLP.sol`

**Description**: The vault inherits standard ERC4626 which is vulnerable to donation attacks. An attacker could:
1. Be the first depositor with minimal LP tokens
2. Transfer LP tokens directly to the vault
3. Inflate the share price for subsequent depositors

**Impact**: Later depositors receive fewer shares than expected due to inflated pricing.

**Recommendation**: Implement virtual shares or minimum liquidity locking similar to Uniswap V2.

### 🟠 High: Slippage Protection Bypass in Periphery

**Location**: `DPoolCurvePeriphery.sol` lines 176-189

**Description**: The `withdrawToAsset` function calculates slippage protection but allows users to provide their own `minAmount` which could override the slippage calculation:
```solidity
uint256 finalMinAmount = minAmount > minAssetFromSlippage 
    ? minAmount : minAssetFromSlippage;
```

**Issue**: If a user sets `minAmount` very high, they bypass slippage protection and the transaction would revert even with acceptable slippage.

**Impact**: Users could accidentally DOS themselves or be tricked into setting inappropriate minimums.

**Recommendation**: Validate that user-provided `minAmount` is reasonable relative to expected output.

### 🟡 Medium: Withdrawal Fee Calculation on Gross Amount

**Location**: `DPoolVaultLP.sol` lines 269-277

**Description**: Withdrawal fees are calculated on the gross LP amount, but the `Withdraw` event emits the net amount. This could cause confusion in accounting.

**Impact**: Off-chain monitoring systems might incorrectly track withdrawals.

**Recommendation**: Consider emitting a separate event for fees collected.

### 🟡 Medium: No Validation of Curve Pool Integrity

**Location**: `DPoolVaultCurveLP.sol` constructor

**Description**: The constructor accepts any address as a Curve pool without validating it implements the expected interface.

**Impact**: Deployment with incorrect pool address would fail at runtime rather than deployment.

**Recommendation**: Add interface validation in constructor.

### 🟡 Medium: Centralization Risk in Asset Whitelisting

**Location**: `DPoolCurvePeriphery.sol`

**Description**: Admin can add/remove whitelisted assets without timelock or multi-sig requirements.

**Impact**: Compromised admin could manipulate which assets are tradeable.

**Recommendation**: Implement timelock for whitelist changes.

### 🟢 Low: Redundant LP Token Storage

**Location**: `DPoolVaultLP.sol`

**Description**: The contract stores `LP_TOKEN` separately when it's already available via `asset()` from ERC4626.

**Recommendation**: Remove redundant storage to save gas.

### 🟢 Low: Missing Pausability

**Location**: Both vault and periphery contracts

**Description**: No pause mechanism for emergency situations.

**Recommendation**: Add pausable functionality for critical functions.

## Attack Vectors Analysis

### Oracle Manipulation Scenarios

1. **Flash Loan Attack on Composite Oracles**: While individual oracles may have TWAP protection, the composite calculation using spot prices could be vulnerable during the combination.

2. **Threshold Gaming**: An attacker could potentially profit by:
   - Pushing prices just above threshold to trigger fixed pricing
   - Arbitraging between actual market price and fixed threshold price

3. **Staleness Exploitation**: With 24-hour heartbeat + 30-minute buffer, prices could be up to 24.5 hours old while still considered "alive".

### dPool Attack Scenarios

1. **Sandwich Attacks**: Despite slippage protection, MEV bots could:
   - Front-run large deposits to increase LP token price
   - Back-run to profit from the price impact
   
2. **Curve Pool Manipulation**: Large trades in the underlying Curve pool could affect the `calc_withdraw_one_coin` calculations used in `previewLPValue`.

## Recommendations Summary

### Immediate Actions Required

1. **Oracle System**:
   - Implement decimal validation for composite oracles
   - Add bounds checking for staleness parameters
   - Validate threshold configurations

2. **dPool System**:
   - Implement first depositor protection
   - Fix slippage protection logic
   - Add interface validation for Curve pools

### Medium-term Improvements

1. **Oracle System**:
   - Implement fallback oracle mechanism
   - Add per-feed heartbeat configuration
   - Implement circuit breakers

2. **dPool System**:
   - Add pausability
   - Implement timelock for admin functions
   - Improve event emissions for fee tracking

### Best Practices

1. Ensure all price feeds are from reputable sources with proven track records
2. Monitor oracle deviations and implement alerts for anomalies
3. Regular security reviews of threshold configurations
4. Implement comprehensive monitoring for LP token donations
5. Consider implementing a gradual rollout with deposit limits

## Conclusion

The Oracle Aggregator system shows good architectural design with role-based access control and modular oracle wrappers. However, several critical issues around decimal precision handling, staleness protection, and threshold manipulation need to be addressed.

The dPool module implements standard ERC4626 patterns but inherits known vulnerabilities around share price manipulation. The Curve integration is generally well-implemented but needs additional validation and protection mechanisms.

Both systems would benefit from additional defensive programming practices, particularly around input validation, bounds checking, and emergency pause mechanisms.