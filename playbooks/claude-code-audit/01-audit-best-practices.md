# Smart Contract Audit Best Practices and Methodologies

## Table of Contents
1. [Audit Methodologies](#audit-methodologies)
2. [Audit Process](#audit-process)
3. [Code Review Techniques](#code-review-techniques)
4. [Threat Modeling](#threat-modeling)
5. [Risk Assessment](#risk-assessment)
6. [Documentation Standards](#documentation-standards)

## 1. Audit Methodologies

### 1.1 Manual Review
Manual review remains the cornerstone of smart contract auditing, as it allows auditors to understand business logic, identify complex vulnerabilities, and assess architectural decisions.

**Key Components:**
- **Line-by-line code review**: Examining each function, modifier, and state variable
- **Business logic verification**: Ensuring code matches intended functionality
- **Economic model analysis**: Validating tokenomics and incentive structures
- **Cross-contract interaction review**: Analyzing how contracts interact with each other

**Best Practices:**
- Start with high-level architecture review before diving into code
- Use multiple reviewers to catch different vulnerability types
- Maintain a checklist of common vulnerabilities
- Document assumptions and invariants

### 1.2 Automated Tools
Automated tools provide efficient coverage for common vulnerability patterns and help ensure consistency.

**Essential Tools:**
- **Slither**: Static analysis framework by Trail of Bits
  - Detects 80+ vulnerability types
  - Custom detector development capability
  - Integration with CI/CD pipelines
  
- **Mythril**: Symbolic execution tool
  - Analyzes EVM bytecode
  - Finds integer overflows, reentrancy, and other issues
  - Generates concrete attack scenarios

- **Echidna**: Property-based fuzzer
  - Tests invariants and properties
  - Generates edge cases automatically
  - Particularly effective for complex mathematical operations

**Tool Usage Strategy:**
```bash
# Example workflow
1. Run Slither for quick static analysis
   slither . --print human-summary
   
2. Execute Mythril for deeper analysis
   myth analyze contracts/MyContract.sol
   
3. Fuzz test with Echidna
   echidna-test . --contract TestContract
```

### 1.3 Formal Verification
Formal verification provides mathematical proofs of correctness for critical properties.

**Approaches:**
- **Model Checking**: Exhaustively explores all possible states
- **Theorem Proving**: Mathematical proofs of correctness
- **Symbolic Execution**: Analyzes all possible execution paths

**Tools and Frameworks:**
- **Certora Prover**: Commercial tool for formal verification
- **K Framework**: Academic framework for formal semantics
- **SMTChecker**: Built into Solidity compiler

**When to Use:**
- Critical financial operations (e.g., AMM pricing algorithms)
- Access control systems
- Token minting/burning logic
- Invariant preservation

## 2. Audit Process

### 2.1 OpenZeppelin Methodology

**Phase 1: Scoping and Planning (1-2 days)**
- Review documentation and specifications
- Identify audit boundaries and dependencies
- Create threat model
- Set up testing environment

**Phase 2: Initial Review (3-5 days)**
- Architecture analysis
- Access control review
- External dependencies assessment
- Initial vulnerability identification

**Phase 3: Deep Dive (5-10 days)**
- Detailed code review
- Edge case analysis
- Integration testing
- Formal verification (if applicable)

**Phase 4: Reporting (2-3 days)**
- Compile findings with severity ratings
- Provide remediation recommendations
- Create executive summary
- Deliver preliminary report

**Phase 5: Remediation Review (1-2 days)**
- Review fixes implemented by development team
- Verify no new issues introduced
- Update report with remediation status

### 2.2 Trail of Bits Methodology

**SLITHER Framework:**
1. **Setup**: Environment configuration and tool installation
2. **Linting**: Code quality and style checks
3. **Information**: Contract complexity and metrics gathering
4. **Testing**: Unit and integration test review
5. **Heuristics**: Pattern-based vulnerability detection
6. **Expert**: Manual review by security experts
7. **Review**: Cross-validation of findings

**Unique Aspects:**
- Heavy emphasis on tooling and automation
- Custom detector development for project-specific issues
- Integration of fuzzing throughout the process
- Focus on invariant testing

### 2.3 ConsenSys Diligence Process

**Pre-Audit Phase:**
- Kickoff call with development team
- Documentation review
- Codebase familiarization
- Threat modeling workshop

**Audit Execution:**
1. **Automated Analysis**: Run MythX suite
2. **Manual Review**: 
   - Security-focused code review
   - Business logic verification
   - Gas optimization opportunities
3. **Testing Enhancement**:
   - Review existing tests
   - Write additional security tests
   - Fuzzing campaign

**Post-Audit:**
- Draft report delivery
- Remediation consultation
- Final report with fix verification
- Optional security monitoring setup

## 3. Code Review Techniques

### 3.1 Systematic Review Approach

**1. Top-Down Analysis:**
```
Start: Contract Architecture
  ↓
Major Components & Interactions
  ↓
Individual Contract Review
  ↓
Function-Level Analysis
  ↓
Line-by-Line Inspection
```

**2. Control Flow Analysis:**
- Map all execution paths
- Identify state changes
- Track external calls
- Document assumptions

**3. Data Flow Analysis:**
- Track variable assignments
- Identify data dependencies
- Analyze storage patterns
- Review memory management

### 3.2 Common Vulnerability Checklist

**Access Control:**
- [ ] Missing or incorrect access modifiers
- [ ] Centralization risks
- [ ] Privilege escalation paths
- [ ] Default initialization vulnerabilities

**Reentrancy:**
- [ ] External calls before state changes
- [ ] Missing reentrancy guards
- [ ] Cross-function reentrancy
- [ ] Read-only reentrancy

**Arithmetic:**
- [ ] Integer overflow/underflow
- [ ] Division by zero
- [ ] Precision loss
- [ ] Rounding errors

**External Interactions:**
- [ ] Unchecked return values
- [ ] Gas griefing vectors
- [ ] Front-running opportunities
- [ ] Oracle manipulation

### 3.3 Pattern Recognition

**Anti-Patterns to Identify:**
```solidity
// Bad: State change after external call
function withdraw(uint amount) external {
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success);
    balances[msg.sender] -= amount; // State change after call
}

// Good: CEI pattern
function withdraw(uint amount) external {
    balances[msg.sender] -= amount; // Check-Effects
    (bool success, ) = msg.sender.call{value: amount}(""); // Interaction
    require(success);
}
```

## 4. Threat Modeling

### 4.1 STRIDE Framework

**S - Spoofing Identity**
- Impersonation attacks
- Signature malleability
- Front-running identity claims

**T - Tampering with Data**
- Storage manipulation
- Memory corruption
- Transaction ordering

**R - Repudiation**
- Missing event logs
- Insufficient audit trail
- Deniable actions

**I - Information Disclosure**
- Private data exposure
- Metadata leakage
- Timing attacks

**D - Denial of Service**
- Gas limit attacks
- Unbounded operations
- Griefing vectors

**E - Elevation of Privilege**
- Access control bypass
- Role manipulation
- Initialization attacks

### 4.2 Attack Trees

**Example: DEX Attack Tree**
```
Goal: Drain DEX Liquidity
├── Price Manipulation
│   ├── Flash Loan Attack
│   ├── Oracle Manipulation
│   └── Sandwich Attack
├── Reentrancy Exploit
│   ├── Direct Reentrancy
│   └── Cross-Contract Reentrancy
└── Access Control Breach
    ├── Uninitialized Proxy
    └── Role Misconfiguration
```

### 4.3 DeFi-Specific Threat Models

**Lending Protocol Threats:**
1. Liquidation manipulation
2. Interest rate manipulation
3. Collateral price oracle attacks
4. Flash loan exploits

**AMM Threats:**
1. Impermanent loss amplification
2. Price oracle manipulation
3. MEV extraction
4. LP token inflation attacks

## 5. Risk Assessment

<a name="severity-matrix"></a>
### 5.1 Severity Classification
**Canonical Severity Matrix**  

| Severity      | Impact                                                        | Simple Example                                  |
| ------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| Critical      | Direct theft of funds or irreversible protocol compromise     | Unprotected reentrancy draining vault           |
| High          | Loss/freeze of funds that can be fixed, or systemic DoS       | Oracle manipulation causing unfair liquidations |
| Medium        | Limited fund loss or degraded UX under specific conditions    | Frontrunning that extracts excess fees          |
| Low           | No direct fund loss, minor inconvenience or best-practice gap | Missing event emission                          |
| Informational | Code-quality or style issues only                             | Unused variable                                 |

_All findings must reference this table instead of redefining severities locally._

### 5.2 Risk Scoring Matrix

```
Impact × Likelihood = Risk Score

Impact:
- Critical: 4
- High: 3
- Medium: 2
- Low: 1

Likelihood:
- Certain: 4
- Likely: 3
- Possible: 2
- Unlikely: 1

Risk Score:
- 12-16: Critical
- 8-11: High
- 4-7: Medium
- 1-3: Low
```

### 5.3 Prioritization Framework

**Priority 1: Immediate Action Required**
- Critical vulnerabilities
- Easily exploitable issues
- Issues affecting user funds

**Priority 2: Should Fix Before Deployment**
- High severity issues
- Issues affecting protocol functionality
- Compliance requirements

**Priority 3: Should Fix Soon**
- Medium severity issues
- Best practice violations with security implications
- Issues that could escalate

**Priority 4: Consider Fixing**
- Low severity issues
- Code quality improvements
- Gas optimizations

## 6. Documentation Standards

### 6.1 Audit Report Structure

**1. Executive Summary**
- Audit scope and timeline
- Key findings overview
- Risk summary
- Recommendations summary

**2. Scope and Methodology**
- Contracts audited (with commit hashes)
- Out-of-scope items
- Tools and techniques used
- Assumptions and limitations

**3. Findings**
Each finding should include:
```markdown
### [SEVERITY] Title of Finding

**Description:**
Clear explanation of the vulnerability

**Impact:**
Potential consequences if exploited

**Proof of Concept:**
Code demonstrating the issue (if applicable)

**Recommendation:**
Specific remediation steps

**Developer Response:**
Team's response and fix status
```

**4. Detailed Analysis**
- Architecture review
- Centralization risks
- External dependencies
- Trust assumptions

**5. Appendices**
- Tool output summaries
- Test results
- Additional recommendations

### 6.2 Writing Clear Findings

**DO:**
- Use clear, concise language
- Provide specific line numbers
- Include code examples
- Offer concrete solutions
- Explain the business impact

**DON'T:**
- Use excessive technical jargon
- Make assumptions about intent
- Provide vague recommendations
- Omit reproduction steps
- Ignore the broader context

### 6.3 Example Finding

```markdown
### [HIGH] Reentrancy in withdraw() Allows Draining of Contract

**Description:**
The `withdraw()` function in `Vault.sol` (lines 45-52) performs an external call to transfer ETH before updating the user's balance, creating a reentrancy vulnerability.

**Impact:**
An attacker can recursively call `withdraw()` to drain all ETH from the contract before their balance is updated.

**Proof of Concept:**
```solidity
contract AttackContract {
    Vault vault;
    uint256 constant AMOUNT = 1 ether;
    
    function attack() external payable {
        vault.deposit{value: AMOUNT}();
        vault.withdraw(AMOUNT);
    }
    
    receive() external payable {
        if (address(vault).balance >= AMOUNT) {
            vault.withdraw(AMOUNT);
        }
    }
}
```

**Recommendation:**
Implement the checks-effects-interactions pattern:
```solidity
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "Insufficient balance");
    
    // Effects before interactions
    balances[msg.sender] -= amount;
    
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "Transfer failed");
}
```

**Developer Response:**
Acknowledged. Will implement CEI pattern and add reentrancy guard.
```

### 6.4 Reporting Best Practices

**1. Audience Awareness**
- Technical findings for developers
- Business impact for stakeholders
- Clear remediation for both

**2. Actionable Recommendations**
- Specific code changes
- Configuration updates
- Process improvements
- Monitoring suggestions

**3. Follow-Up Structure**
- Initial report delivery
- Q&A session
- Remediation review
- Final report with verification

**4. Communication Guidelines**
- Regular updates during audit
- Clear escalation paths
- Collaborative approach
- Educational tone

## Conclusion

Effective smart contract auditing requires a combination of systematic methodologies, advanced tooling, and deep security expertise. By following these best practices, auditors can identify vulnerabilities, assess risks accurately, and provide valuable guidance to development teams. The key is to maintain a balance between automated analysis and manual review while ensuring clear communication throughout the process.