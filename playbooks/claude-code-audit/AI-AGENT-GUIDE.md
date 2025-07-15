# AI Agent Audit Execution Guide

This guide provides specific instructions for AI agents conducting security audits on the dTRINITY protocol. Follow these steps systematically to ensure comprehensive coverage.

## 🤖 Pre-Audit Setup

### 1. Initialize Your Working Environment
```bash
# Create your audit workspace
mkdir audit-workspace
cd audit-workspace

# Create tracking files
touch audit-scope-tree.md
touch findings.md
touch audit-notes.md
```

### 2. Load Context
Read these files in order:
1. `playbooks/claude-code-audit/04-audit-scope.md` - Understand what to audit
2. `playbooks/claude-code-audit/05-protocol-overview.md` - Understand the protocol
3. `playbooks/claude-code-audit/02-vulnerability-catalog.md` - Know what to look for
4. `CLAUDE.md` - Understand project-specific context

## 📋 Systematic Audit Process

### Step 1: Create Scope Tree (⏱️ 30 minutes)

Create a scope tree in `audit-scope-tree.md` with checkboxes:

```markdown
# Audit Scope Tree

## dStable System
- [ ] ⏳ contracts/dstable/ERC20StablecoinUpgradeable.sol
- [ ] ⏳ contracts/dstable/Issuer.sol
- [ ] ⏳ contracts/dstable/Redeemer.sol
- [ ] ⏳ contracts/dstable/RedeemerWithFees.sol
- [ ] ⏳ contracts/dstable/CollateralVault.sol
- [ ] ⏳ contracts/dstable/CollateralVaultFraxtal.sol
- [ ] ⏳ contracts/dstable/AmoManager.sol
- [ ] ⏳ contracts/dstable/AmoVault.sol

## dStake System
- [ ] ❌ contracts/vaults/dstake/DStakeToken.sol (KNOWN ISSUE: withdrawal bug)
- [ ] ⏳ contracts/vaults/dstake/DStakeCollateralVault.sol
[... continue for all in-scope contracts]
```

### Step 2: Run Automated Tools (⏱️ 1-2 hours)

Execute in parallel:
```bash
# Run static analysis
make slither > reports/slither-output.txt
make mythril > reports/mythril-output.txt

# Generate visualizations
surya graph contracts/**/*.sol | dot -Tpng > reports/call-graph.png
surya inheritance contracts/**/*.sol | dot -Tpng > reports/inheritance.png

# Check test coverage
npx hardhat coverage
```

### Step 3: Module-by-Module Review

For each module, follow this process:

#### 3.1 Read Design Documentation
```
1. Read design-docs/[module]-design.md
2. Note key invariants and security assumptions
3. Understand intended behavior
```

#### 3.2 Analyze Entry Points
For each contract:
```
1. Identify all external/public functions
2. Map access control requirements
3. Trace data flow
4. Check state modifications
```

#### 3.3 Apply Vulnerability Checklist
For each contract, check:
```
□ Reentrancy vulnerabilities
□ Integer overflow/underflow
□ Access control issues
□ Oracle manipulation risks
□ Flash loan attack vectors
□ Storage collision risks
□ Initialization issues
□ Upgrade safety
□ External call safety
□ Token handling issues
```

#### 3.4 Document Findings
Use this template in `findings.md`:
```markdown
## [SEVERITY-NUM] Finding Title
**Contract**: FileName.sol
**Function**: functionName()
**Line**: 123
**Severity**: Critical/High/Medium/Low

### Description
[What is the issue?]

### Impact
[What can happen?]

### Proof of Concept
```solidity
// Show how to exploit
```

### Recommendation
[How to fix it]

---
```

### Step 4: Cross-Module Analysis (⏱️ 2-3 hours)

#### 4.1 Integration Points
```
1. Map all cross-contract calls
2. Verify trust assumptions
3. Check for circular dependencies
4. Analyze failure propagation
```

#### 4.2 Economic Analysis
```
1. Model token flows
2. Calculate maximum extractable value
3. Analyze incentive structures
4. Check for economic attacks
```

### Step 5: Deep Dive Areas

Based on the protocol, focus extra attention on:

#### 5.1 dStake Withdrawal Bug
```solidity
// contracts/vaults/dstake/DStakeToken.sol
function _withdraw(...) {
    // MISSING: Check allowance before withdrawal
    // This allows unauthorized withdrawals!
}
```

#### 5.2 Oracle Dependencies
- Check all `OracleAggregatorV2` usage
- Verify price manipulation resistance
- Check staleness checks

#### 5.3 dLoop Leverage Mechanics
- Verify leverage calculations
- Check liquidation thresholds
- Analyze rebalancing logic

## 🔍 Specific Patterns to Search For

### High-Risk Code Patterns
```bash
# Unchecked external calls
grep -r "\.call(" contracts/ | grep -v "success"

# Delegatecall usage
grep -r "delegatecall" contracts/

# Admin functions without timelocks
grep -r "onlyRole.*DEFAULT_ADMIN" contracts/

# Missing reentrancy guards
grep -r "external.*payable" contracts/ | grep -v "nonReentrant"

# Unprotected initializers
grep -r "initialize.*external" contracts/ | grep -v "initializer"
```

## 📊 Tracking Progress

Update your scope tree as you progress:
- ⏳ = Not started
- 🔄 = In progress
- ✅ = Completed, no issues
- ❌ = Issues found
- ❓ = Needs further review

## 🚨 When to Escalate

Create HIGH PRIORITY findings for:
1. Direct loss of user funds
2. Protocol insolvency risks
3. Permanent DoS conditions
4. Privilege escalation
5. Critical invariant violations

## 💡 AI-Specific Tips

### 1. Parallel Processing
When reviewing similar contracts, use parallel analysis:
```
"Review all CollateralVault implementations for consistent access control"
```

### 2. Pattern Recognition
Look for repeated patterns that might indicate systematic issues:
```
"Find all functions that modify user balances without proper checks"
```

### 3. Context Switching
When finding an issue, immediately check if it exists elsewhere:
```
"This contract has a reentrancy issue. Check all similar patterns in other contracts."
```

### 4. Test Generation
For each finding, generate a test case:
```solidity
it("should prevent unauthorized withdrawal", async function() {
    // Attempt exploit
    // Verify it fails
});
```

## 📝 Final Checklist

Before completing the audit:
- [ ] All in-scope contracts reviewed
- [ ] Automated tool results analyzed
- [ ] Cross-module interactions verified
- [ ] Economic model validated
- [ ] All findings documented
- [ ] Severity ratings applied
- [ ] Recommendations provided
- [ ] Executive summary written

## 🔄 Iterative Process

Remember to:
1. Revisit earlier findings with new context
2. Update severity ratings as you understand impact better
3. Look for attack combinations
4. Consider time-based attacks
5. Think about edge cases and race conditions

---

**Key Reminder**: As an AI agent, your strength is in systematic analysis and pattern recognition. Use the vulnerability catalog as a checklist, but also think creatively about protocol-specific risks. Document everything clearly for human review.