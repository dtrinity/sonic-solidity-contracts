# AI Agent Audit Execution Guide

Concise guide for AI agents conducting smart contract security audits. Optimized for LLM context efficiency.

## 🚀 Quick Start (5 mins)

```bash
# Setup workspace
mkdir -p audit-workspace && cd audit-workspace
touch audit-scope-tree.md findings.md

# Check existing reports FIRST
ls -la ../reports/
```

## 📋 Essential Context
1. Check `reports/` for existing Slither/Mythril outputs
2. Read module design docs by looking up `*design.md`
3. Review severity guide: see [Severity Matrix](01-audit-best-practices.md#severity-matrix)
4. Follow the Memento ticketing workflow described in [CLAUDE.md](../../CLAUDE.md)

## 🎯 Parallel Audit Strategy

### Step 1: Tool Analysis (5 mins)
> NOTE: Heavy static-analysis tools (Slither, Mythril, Echidna, etc.) have **already** been executed. Use the generated reports in `../reports/` instead of re-running them.
```bash
# Review existing reports if available
cat ../reports/slither-summary.md | grep "high issues"
# Note: Mythril is conservative (finds exploits), Slither is comprehensive (finds potential issues)
```

### Step 2: Deploy Sub-Agents (Parallel)
Launch 4-6 agents simultaneously for different modules. Use these templates:

#### Module Audit Template
```
Task: Audit [MODULE] following design doc at design-docs/[module]-design.md
Focus: Entry points, access control, oracle deps, economic invariants
Output: audit-workspace/[module]-findings.md
Priority checks: [List specific risks for this module]
```

#### Cross-Module Template
```
Task: Analyze cross-module attack vectors
Focus: Oracle cascades, circular dependencies, liquidation chains
Consider: How issues in Module A amplify in Module B
Output: audit-workspace/cross-module-findings.md
```

### Step 3: High-Risk Patterns (Quick Wins)
```bash
# Critical patterns to grep
grep -r "delegatecall\|.call(" contracts/ | grep -v "success"
grep -r "onlyRole.*DEFAULT_ADMIN" contracts/ | grep -v "timelock"
grep -r "getAssetPrice" contracts/ | grep -v "staleness"
grep -r "_withdraw\|transferFrom" contracts/ | grep -v "allowance"
```

### Step 4: Finding Format (Strict)
```markdown
## [MODULE-SEVERITY-NUM] Title (e.g., DSTABLE-CRIT-01)
**Contract**: File.sol:123
**Function**: funcName()
**Severity**: Critical/High/Medium/Low

**Description**: One sentence summary
**Impact**: Specific consequence (funds lost, DoS, etc.)
**PoC**: Minimal code showing exploit
**Fix**: Concrete recommendation
```

## 🔍 Module Dependencies

### Oracle → All Modules
- Price manipulation affects everything
- Staleness = system-wide vulnerability

### dStable ↔ dStake
- dStake holds dStable as collateral
- Circular dependency risk

### dLoop → dLend → dStake
- Liquidation cascade path
- Interest rate feedback loops

### All → CollateralVault
- Central trust point
- Admin compromise = total failure

## 📊 Finding Consolidation

After parallel execution:
1. Merge findings by severity
2. De-duplicate similar issues
3. Link cross-module impacts
4. Generate executive summary

## ⚡ Economic Attack Patterns

### Oracle Sandwich
```
Cost: Flash loan fee (0.09%)
Profit: 1-5% of victim volume
Risk: MEV competition
```

### Liquidation Cascade
```
Trigger: 5% price drop
Amplification: 2-3x through modules
Profit: 5-10% of liquidated positions
```

### Subsidy Gaming (dLoop)
```
Setup: Create imbalanced position
Profit: Rebalancing rewards
Frequency: Every rebalance cycle
```

## 🎓 Time Allocation (90 mins total)

- Setup & Tools: 5 mins
- Parallel Module Audits: 45 mins
- Cross-Module Analysis: 20 mins
- Economic Analysis: 10 mins
- Report Generation: 10 mins

**Note**: AI agents complete audits 50-100x faster than humans. Focus on systematic coverage over time spent.