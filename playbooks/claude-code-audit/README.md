# Claude Code Smart Contract Audit Playbook

This playbook provides a comprehensive framework for conducting security audits on the dTRINITY protocol using AI agents. It combines industry best practices, automated tools, and systematic approaches to identify vulnerabilities and ensure protocol security.

## 📋 Quick Start Checklist

1. [ ] Review the audit scope document (`04-audit-scope.md`)
2. [ ] Read protocol overview and design documents
3. [ ] Set up audit tools (see `03-audit-tools-guide.md`)
4. [ ] Create initial audit report structure
5. [ ] Begin systematic review following the methodology

## 📚 Playbook Structure

### Core Documents

1. **[01-audit-best-practices.md](01-audit-best-practices.md)** - Comprehensive guide to audit methodologies, processes, and documentation standards
2. **[02-vulnerability-catalog.md](02-vulnerability-catalog.md)** - Detailed catalog of smart contract vulnerabilities with detection and remediation strategies
3. **[03-audit-tools-guide.md](03-audit-tools-guide.md)** - Complete guide to static analysis, dynamic testing, and manual review tools
4. **[04-audit-scope.md](04-audit-scope.md)** - Defines in-scope and out-of-scope contracts with module breakdowns
5. **[05-protocol-overview.md](05-protocol-overview.md)** - Condensed protocol documentation focused on security considerations

### Design Documents

- **[dstake-design.md](design-docs/dstake-design.md)** - Updated design document for the dStake staking system
- **[dstable-design.md](design-docs/dstable-design.md)** - Comprehensive design for the dStable stablecoin system
- **[dloop-design.md](design-docs/dloop-design.md)** - Design documentation for dLoop leveraged yield farming

## 🎯 Audit Workflow

### Phase 1: Preparation (1-2 days)
1. **Scope Review**
   - Read `04-audit-scope.md` to understand boundaries
   - Verify contract locations and dependencies
   - Create scope tree with audit status tracking

2. **Protocol Understanding**
   - Study `05-protocol-overview.md` for high-level context
   - Review design documents for each module
   - Understand economic model and attack surfaces

3. **Tool Setup**
   - Configure tools per `03-audit-tools-guide.md`
   - Run initial automated scans
   - Set up development environment

### Phase 2: Automated Analysis (1-2 days)
1. **Static Analysis**
   ```bash
   # Run Slither with custom detectors
   slither . --checklist
   
   # Run Mythril for symbolic execution
   myth analyze contracts/**/*.sol
   
   # Generate call graphs
   surya graph contracts/**/*.sol | dot -Tpng > call-graph.png
   ```

2. **Dynamic Testing**
   - Run existing test suite
   - Add invariant tests for critical properties
   - Fuzz test with Echidna

### Phase 3: Manual Review (3-5 days)
1. **Module-by-Module Analysis**
   - Follow methodology from `01-audit-best-practices.md`
   - Use vulnerability catalog (`02-vulnerability-catalog.md`) as checklist
   - Document findings in structured format

2. **Cross-Module Interactions**
   - Analyze integration points
   - Check for composability issues
   - Verify access control consistency

3. **Economic Analysis**
   - Model attack scenarios
   - Calculate potential profits/losses
   - Verify incentive alignment

### Phase 4: Reporting (1-2 days)
1. **Finding Documentation**
   - Use template from best practices guide
   - Include severity, impact, and likelihood
   - Provide clear remediation steps

2. **Report Generation**
   - Executive summary
   - Detailed findings
   - Risk assessment matrix
   - Recommendations

## 🚨 Critical Focus Areas

Based on the protocol analysis, prioritize review of:

1. **dStake Withdrawal Bug** - Known issue with missing allowance check in `DStakeToken._withdraw`
2. **Oracle Dependencies** - All modules rely heavily on price feeds
3. **Cross-Protocol Interactions** - dLoop's integration with multiple venues
4. **Upgrade Mechanisms** - Most contracts are upgradeable
5. **Access Control** - Complex role hierarchy across modules
6. **Economic Attacks** - Flash loan vulnerabilities, especially in dLoop

## 🛠️ Tool Commands Reference

### Quick Audit Commands
```bash
# Full automated scan
make audit

# Individual tools
make slither
make mythril

# Test coverage
npx hardhat coverage

# Gas analysis
npx hardhat gas-reporter
```

### Manual Review Helpers
```bash
# Find all external calls
grep -r "\.call\|\.delegatecall\|\.staticcall" contracts/

# Find all token transfers
grep -r "transfer\|transferFrom\|safeTransfer" contracts/

# Find all admin functions
grep -r "onlyRole\|onlyOwner\|onlyAdmin" contracts/
```

## 📊 Severity Classification

Use this matrix for consistent severity ratings:

| Severity | Impact | Likelihood | Example |
|----------|---------|------------|----------|
| Critical | Total loss of funds | High | Unrestricted withdrawal |
| High | Partial loss of funds | Medium | Oracle manipulation |
| Medium | Griefing/DoS | Medium | Gas exhaustion |
| Low | Suboptimal behavior | Low | Missing events |

## 🔄 Continuous Improvement

This playbook should be updated with:
- New vulnerability patterns discovered
- Tool updates and configurations
- Lessons learned from audits
- Protocol-specific considerations

## 📝 Audit Report Template

```markdown
# [Protocol Name] Security Audit Report

## Executive Summary
- Audit dates
- Scope summary
- Key findings
- Overall assessment

## Scope
[Use tree from 04-audit-scope.md]

## Findings

### [CRIT-01] Title
**Severity**: Critical
**Component**: Contract.sol
**Line**: 123

**Description**: 
[Detailed description]

**Impact**: 
[Potential consequences]

**Proof of Concept**:
```solidity
// Attack code
```

**Recommendation**:
[Specific fix]

## Risk Matrix
[Summary table of all findings]
```

---

**Remember**: The goal is systematic, thorough analysis that combines automated tools with expert manual review. Use this playbook as a framework, but always think critically about protocol-specific risks and edge cases.