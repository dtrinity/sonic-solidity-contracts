# Sub-Agent Task Templates

Copy-paste templates for deploying parallel audit agents. Replace [PLACEHOLDERS] with specific values.

## 🔍 Module Audit Template

```
You are a smart contract security auditor. Audit the [MODULE] module.

Context:
- Design doc: playbooks/claude-code-audit/design-docs/[module]-design.md
- Vulnerability catalog: playbooks/claude-code-audit/02-vulnerability-catalog.md
- Severity: Critical=theft, High=DoS/freeze, Medium=temp DoS, Low=minor loss

Contracts to audit:
[LIST SPECIFIC CONTRACT PATHS]

Priority checks:
- [MODULE-SPECIFIC RISK 1]
- [MODULE-SPECIFIC RISK 2]
- [MODULE-SPECIFIC RISK 3]

Output findings to: audit-workspace/[module]-findings.md
Format: [MODULE-SEVERITY-NUM] with Contract:Line, Impact, PoC, Fix
```

## 🔗 Cross-Module Analysis Template

```
You are analyzing cross-module vulnerabilities in dTRINITY.

Known issues from modules:
[PASTE KEY FINDINGS FROM MODULE AUDITS]

Tasks:
1. Map attack chains (e.g., Oracle→dStable→dStake)
2. Find amplification effects
3. Identify circular dependencies
4. Check shared admin risks

Focus on:
- Oracle manipulation cascades
- Liquidation chains
- Recursive collateral risks
- Admin key compromise paths

Output to: audit-workspace/cross-module-findings.md
```

## 💰 Economic Analysis Template

```
You are an economic security analyst for dTRINITY.

Protocol economics:
- dStable: Overcollateralized stablecoin
- dStake: Yield-bearing vault
- dLoop: Leveraged farming with subsidies
- dPool: Curve LP integration

Calculate profitability for:
1. Oracle sandwich attacks
2. Liquidation cascades
3. Subsidy extraction
4. MEV opportunities

Include:
- Attack cost vs profit
- Required capital
- Success probability
- Mitigation difficulty

Output to: audit-workspace/economic-findings.md
```

## 🚀 Quick Pattern Search Template

```
Search for high-risk patterns in [MODULE].

Critical patterns:
1. Missing allowance checks in transfers
2. Unvalidated oracle prices
3. Admin functions without timelock
4. Reentrancy vulnerabilities
5. Integer overflow in calculations

Run these greps:
grep -r "transferFrom\|safeTransferFrom" [PATH] | grep -v "allowance"
grep -r "getAssetPrice" [PATH] | grep -v "staleness\|validation"
grep -r "onlyRole\|onlyOwner" [PATH] | grep -v "timelock"

Report any findings with code location and impact.
```

## 📊 Slither Analysis Template

```
Analyze Slither findings for [MODULE].

Input: reports/slither-summary.md
Focus on: [MODULE] contracts only

Filter out:
- Naming conventions
- Gas optimizations
- External calls to trusted contracts

Prioritize:
- Reentrancy risks
- Access control issues
- Integer overflows
- Uninitialized storage

For each relevant finding:
1. Verify if exploitable
2. Assess real impact
3. Check if already known

Output: audit-workspace/[module]-slither-analysis.md
```

## 🔄 Finding Consolidation Template

```
Consolidate findings from all audit agents.

Input files:
- audit-workspace/*-findings.md
- audit-workspace/*-analysis.md

Tasks:
1. Merge by severity (Critical→High→Medium→Low)
2. De-duplicate similar issues
3. Link related findings across modules
4. Count total issues by category

Create summary table:
| Module | Critical | High | Medium | Low | Total |

Output: audit-workspace/consolidated-findings.md
```