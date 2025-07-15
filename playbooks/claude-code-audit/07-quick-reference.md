# Quick Reference Checklist

One-page reference for AI agents during audits. Keep this open while reviewing code.

## 🔴 Critical Patterns (Always Flag)

```bash
# Missing access control
grep -r "function.*external\|public" FILE | grep -v "onlyRole\|onlyOwner\|private\|internal"

# Unvalidated oracle prices
grep -r "getAssetPrice\|getPrice" FILE | grep -B2 -A2 -v "require\|revert\|staleness"

# Missing allowance checks
grep -r "transferFrom\|safeTransferFrom" FILE | grep -B2 -v "allowance\|approve"

# Dangerous delegatecall
grep -r "delegatecall" FILE | grep -v "onlyOwner\|onlyRole"
```

## 🟠 High-Risk Areas by Module

### dStable
- [ ] Oracle manipulation in Issuer/Redeemer
- [ ] AMO allocation without slippage
- [ ] Admin can break backing invariant
- [ ] Integer overflow in profit calculations

### dStake  
- [ ] Router can be changed by admin
- [ ] Surplus handling race condition
- [ ] Missing withdrawal allowance (CHECK IF FIXED)
- [ ] Adapter trust assumptions

### dLoop
- [ ] Leverage calculation precision
- [ ] Flash loan callback validation
- [ ] Subsidy gaming opportunities
- [ ] MEV during rebalancing

### Oracle
- [ ] Decimal precision mismatches
- [ ] Missing staleness checks
- [ ] Threshold bypasses
- [ ] Single oracle dependency

### dPool
- [ ] LP token donation attacks
- [ ] Curve pool validation
- [ ] Slippage bypass logic
- [ ] Withdrawal fee confusion

## 📊 Severity Quick Guide

| Finding | Severity |
|---------|----------|
| Steal user funds directly | CRITICAL |
| Permanent freeze of funds | HIGH |
| Temporary freeze (fixable) | MEDIUM |
| Small losses, annoyances | LOW |

## 🔍 Vulnerability to Grep Mapping

| Vulnerability | Search Pattern |
|--------------|----------------|
| Reentrancy | `external.*\{` without `nonReentrant` |
| Integer overflow | `unchecked.*[+*-/]` |
| Access control | `function.*external` without modifier |
| Oracle manipulation | `getPrice` without validation |
| Frontrunning | `transfer.*msg.sender` in same tx |
| Flash loan | `flashLoan` without validation |

## ⚡ Economic Calculations

### Oracle Manipulation Profit
```
Profit = (Manipulated Price - Real Price) × Volume
Cost = Flash Loan Fee (0.09%)
Required: Profit > Cost
```

### Liquidation Profit
```
Profit = Collateral × Liquidation Discount
Typical discount: 5-10%
MEV competition reduces profit
```

### Subsidy Extraction (dLoop)
```
Profit = Subsidy Rate × Position Size × Time
Cost = Gas + Capital lockup
Optimal: Large positions near rebalance threshold
```

## 🚨 Instant Red Flags

1. **No Timelock** = Admin rug risk
2. **Single Oracle** = Price manipulation
3. **Upgradeable + No Delay** = Instant compromise
4. **Complex Math in Unchecked** = Overflow risk
5. **External Calls Before State** = Reentrancy
6. **No Slippage Protection** = Sandwich attacks

## 📝 Finding ID Format

```
[MODULE]-[SEVERITY]-[NUMBER]
Example: DSTABLE-CRIT-01
```

Modules: DSTABLE, DSTAKE, DLOOP, DPOOL, ORACLE, COMMON
Severities: CRIT, HIGH, MED, LOW