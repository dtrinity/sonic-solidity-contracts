# Smart Contract Audit Tools Guide

This comprehensive guide covers the essential tools for conducting smart contract security audits, their usage patterns, configurations, and integration strategies.

## Table of Contents

1. [Static Analysis Tools](#static-analysis-tools)
2. [Dynamic Analysis Tools](#dynamic-analysis)
3. [Manual Review Tools](#manual-review-tools)
4. [Integration Strategies](#integration-strategies)
5. [Tool Limitations](#tool-limitations)
6. [Practical Workflows](#practical-workflows)

## Static Analysis Tools

### 1. Slither - Trail of Bits

Slither is a static analysis framework that runs a suite of vulnerability detectors, prints visual information about contract details, and provides an API to easily write custom analyses.

#### Installation

```bash
pip install slither-analyzer
```

#### Basic Usage

```bash
# Run all detectors
slither .

# Run with specific configuration
slither . --config-file slither.config.json

# Run on specific contract
slither contracts/path/to/Contract.sol

# Generate different reports
slither . --print human-summary
slither . --print contract-summary
slither . --print function-summary
slither . --print vars-and-auth
```

#### Configuration (slither.config.json)

```json
{
  "detectors_to_exclude": "naming-convention,external-function,solc-version",
  "exclude_dependencies": true,
  "exclude_optimization": false,
  "exclude_informational": false,
  "exclude_low": false,
  "exclude_medium": false,
  "exclude_high": false,
  "fail_on": "high",
  "json": "reports/slither-report.json",
  "filter_paths": "node_modules,lib,test,mocks"
}
```

#### Custom Detectors

Create custom detectors for project-specific patterns:

```python
from slither.detectors.abstract_detector import AbstractDetector, DetectorClassification

class CustomDetector(AbstractDetector):
    ARGUMENT = 'custom-check'
    HELP = 'Description of custom check'
    IMPACT = DetectorClassification.HIGH
    CONFIDENCE = DetectorClassification.HIGH
    
    def _detect(self):
        results = []
        for contract in self.contracts:
            # Custom detection logic
            if self.is_vulnerable(contract):
                info = [contract, " has vulnerability\n"]
                results.append(self.generate_result(info))
        return results
```

#### Interpreting Results

- **High**: Critical issues requiring immediate attention
- **Medium**: Important issues that should be addressed
- **Low**: Best practice violations
- **Informational**: Code quality suggestions

#### Advanced Commands

```bash
# Check for upgradeability issues
slither-check-upgradeability . Contract --new-contract-name ContractV2

# Generate call graphs
slither . --print call-graph

# Find similar variables (typo detection)
slither . --print similar-names

# Data dependency analysis
slither . --print data-dependency
```

### 2. Mythril - ConsenSys

Mythril uses symbolic execution, SMT solving, and taint analysis to detect vulnerabilities.

#### Installation

```bash
pip install mythril
docker pull mythril/myth  # Alternative Docker installation
```

#### Basic Usage

```bash
# Analyze single file
myth analyze contracts/Contract.sol

# Analyze with specific settings
myth analyze contracts/Contract.sol \
  --solv 0.8.20 \
  --max-depth 10 \
  --execution-timeout 300 \
  -t 3  # transaction count

# Output formats
myth analyze contracts/Contract.sol -o json
myth analyze contracts/Contract.sol -o markdown
```

#### Configuration

Create a `mythril.yaml` configuration:

```yaml
# Solver timeout
solver-timeout: 10000

# Analysis modules to enable/disable
analysis-modules:
  - detection
  - symbolic
  
# Custom signature database
signature-db: ./signatures.db

# RPC settings for live contract analysis
infura-id: YOUR_INFURA_ID
```

#### Advanced Analysis

```bash
# Deep analysis with more transactions
myth analyze Contract.sol -t 5 --max-depth 22

# Analyze deployed contract
myth analyze --address 0x123... --infura-id YOUR_ID

# Create control flow graph
myth analyze Contract.sol --graph

# Use specific solc version
myth analyze Contract.sol --solv 0.8.20
```

#### Interpreting Mythril Output

```json
{
  "success": true,
  "error": null,
  "issues": [
    {
      "title": "Integer Arithmetic Bugs",
      "severity": "High",
      "description": "The arithmetic operator can overflow/underflow",
      "function": "withdraw(uint256)",
      "type": "Warning",
      "address": 180,
      "debug": "Transaction sequence: ['constructor()', 'withdraw(115792089237316195423570985008687907853269984665640564039457584007913129639935)']"
    }
  ]
}
```

### 3. Echidna - Trail of Bits

Echidna is a property-based fuzzer for Ethereum smart contracts.

#### Installation

```bash
# Download pre-built binary
wget https://github.com/crytic/echidna/releases/download/v2.2.1/echidna-2.2.1-Linux.zip
unzip echidna-2.2.1-Linux.zip

# Or build from source
git clone https://github.com/crytic/echidna
cd echidna
stack install
```

#### Writing Echidna Tests

```solidity
contract TestToken is Token {
    // Echidna will try to break these properties
    function echidna_balance_under_1000() public returns (bool) {
        return balanceOf(msg.sender) <= 1000;
    }
    
    function echidna_total_supply_constant() public returns (bool) {
        return totalSupply == 10000;
    }
}
```

#### Configuration (echidna.yaml)

```yaml
testMode: assertion  # or property, exploration
testLimit: 50000     # number of tests
seqLen: 100         # length of transaction sequence
contractAddr: "0x00a329c0648769a73afac7f9381e08fb43dbea72"
deployer: "0x30000"
sender: ["0x10000", "0x20000", "0x30000"]
coverage: true
corpusDir: "corpus"
```

#### Running Echidna

```bash
# Basic run
echidna-test contracts/Token.sol --contract TestToken

# With configuration
echidna-test contracts/Token.sol --config echidna.yaml

# Generate coverage report
echidna-test contracts/Token.sol --coverage

# Save corpus for regression testing
echidna-test contracts/Token.sol --corpus-dir corpus
```

#### Advanced Fuzzing Strategies

```solidity
contract AdvancedTest {
    // State machine testing
    enum State { INIT, ACTIVE, PAUSED }
    State public state = State.INIT;
    
    function echidna_state_transitions() public returns (bool) {
        // State should only transition forward
        return uint(state) >= uint(State.INIT);
    }
    
    // Differential testing
    function echidna_old_vs_new_implementation() public returns (bool) {
        uint256 oldResult = oldImplementation.calculate(x);
        uint256 newResult = newImplementation.calculate(x);
        return oldResult == newResult;
    }
}
```

### 4. Certora - Formal Verification

Certora provides formal verification through specification and mathematical proofs.

#### Installation

```bash
pip install certora-cli
```

#### Writing Specifications

```javascript
// Token.spec
methods {
    function totalSupply() external returns (uint256) envfree;
    function balanceOf(address) external returns (uint256) envfree;
    function transfer(address, uint256) external returns (bool);
}

// Invariant: sum of all balances equals total supply
ghost mapping(address => uint256) balanceSum;

hook Sstore balanceOf[KEY address a] uint256 newBalance (uint256 oldBalance) {
    balanceSum[a] = newBalance;
}

invariant totalSupplyEqualsSum()
    totalSupply() == sumOfBalances()
```

#### Running Certora

```bash
# Basic verification
certoraRun contracts/Token.sol --verify Token:specs/Token.spec

# With configuration file
certoraRun --conf certora.conf

# Generate report
certoraRun contracts/Token.sol --verify Token:specs/Token.spec \
  --report results/certora_report.html
```

#### Configuration (certora.conf)

```json
{
    "files": [
        "contracts/Token.sol",
        "contracts/TokenV2.sol"
    ],
    "verify": "Token:specs/Token.spec",
    "solc": "solc8.20",
    "msg": "Verifying token invariants",
    "rule_sanity": "basic",
    "send_only": false,
    "staging": false
}
```

## Dynamic Analysis

### 1. Foundry Invariant Testing

Foundry provides powerful invariant testing capabilities through its fuzzing engine.

#### Writing Invariant Tests

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Token.sol";

contract TokenInvariantTest is Test {
    Token public token;
    address[] public actors;
    
    function setUp() public {
        token = new Token();
        actors.push(address(0x1));
        actors.push(address(0x2));
        actors.push(address(0x3));
    }
    
    // Invariant: Total supply never changes
    function invariant_totalSupplyConstant() public {
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
    }
    
    // Invariant: Sum of balances equals total supply
    function invariant_solvency() public {
        uint256 sum;
        for (uint i = 0; i < actors.length; i++) {
            sum += token.balanceOf(actors[i]);
        }
        assertEq(sum, token.totalSupply());
    }
}
```

#### Running Invariant Tests

```bash
# Run invariant tests
forge test --match-contract Invariant

# With deeper fuzzing
forge test --match-contract Invariant --fuzz-runs 10000

# Show coverage
forge coverage --match-contract Invariant
```

### 2. Hardhat Security Plugins

#### hardhat-security

```bash
npm install --save-dev hardhat-security
```

Configuration in `hardhat.config.ts`:

```typescript
import "hardhat-security";

module.exports = {
  security: {
    /**
     * @type {import('hardhat-security/dist/src/types').HardhatSecurityConfig}
     */
    enabled: true,
    runOnCompile: true,
    severity: {
      low: true,
      medium: true,
      high: true
    }
  }
};
```

#### hardhat-gas-reporter

```bash
npm install --save-dev hardhat-gas-reporter
```

Configuration:

```typescript
import "hardhat-gas-reporter";

module.exports = {
  gasReporter: {
    enabled: true,
    currency: 'USD',
    gasPrice: 21,
    outputFile: 'gas-report.txt',
    noColors: true,
    coinmarketcap: COINMARKETCAP_API_KEY
  }
};
```

### 3. Coverage Analysis

#### Hardhat Coverage

```bash
npm install --save-dev solidity-coverage
```

Usage:

```bash
# Generate coverage report
npx hardhat coverage

# With specific tests
npx hardhat coverage --testfiles "test/Token.test.ts"

# Generate lcov report
npx hardhat coverage --report lcov
```

#### Foundry Coverage

```bash
# Basic coverage
forge coverage

# Detailed report
forge coverage --report lcov

# Coverage for specific contract
forge coverage --match-contract Token
```

## Manual Review Tools

### 1. VS Code Extensions

#### Essential Extensions

1. **Solidity Visual Developer**
   - Syntax highlighting
   - Security patterns detection
   - Call graph generation
   - UML diagram generation

2. **Solidity Metrics**
   - Complexity analysis
   - Contract size metrics
   - Function visibility analyzer

3. **Slither VSCode**
   - Integrated Slither analysis
   - Real-time vulnerability detection

4. **Remix IDE**
   - In-browser analysis
   - Static analysis plugin
   - Security scanner

#### VS Code Settings

```json
{
  "solidity.compileUsingRemoteVersion": "v0.8.20+commit.a1b79de6",
  "solidity.defaultCompiler": "remote",
  "solidity.linter": "solhint",
  "solidity.enabledAsYouTypeCompilationErrorCheck": true,
  "editor.formatOnSave": true,
  "[solidity]": {
    "editor.defaultFormatter": "JuanBlanco.solidity"
  }
}
```

### 2. Visualization Tools

#### Surya - Code Inspector

```bash
npm install -g surya

# Generate inheritance graph
surya inheritance contracts/**/*.sol | dot -Tpng > inheritance.png

# Generate control flow graph
surya graph contracts/Token.sol | dot -Tpng > graph.png

# Generate markdown report
surya mdreport report.md contracts/**/*.sol
```

#### Solgraph

```bash
npm install -g solgraph

# Generate DOT file
solgraph contracts/Token.sol > Token.dot

# Convert to image
dot -Tpng Token.dot -o Token.png
```

#### sol2uml

```bash
npm install -g sol2uml

# Generate class diagram
sol2uml contracts --outputFileName diagram.svg

# With specific depth
sol2uml contracts --outputFileName diagram.svg --classDepth 2
```

### 3. Call Graph Generators

#### Slither Call Graph

```bash
# Generate call graph
slither . --print call-graph

# Function summary with callers
slither . --print function-summary

# Human readable call paths
slither . --print human-summary
```

## Integration Strategies

### 1. CI/CD Pipeline Integration

#### GitHub Actions Example

```yaml
name: Security Analysis

on: [push, pull_request]

jobs:
  slither:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: crytic/slither-action@v0.3.0
        with:
          fail-on: high
          slither-args: --filter-paths "node_modules"
          
  mythril:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Mythril
        uses: consensys/mythril-action@v1
        with:
          args: analyze contracts/ --solv 0.8.20
          
  echidna:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Echidna
        uses: crytic/echidna-action@v2
        with:
          contract: TestContract
          config: echidna.yaml
```

### 2. Pre-commit Hooks

`.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: slither
        name: Slither Analysis
        entry: slither . --fail-high
        language: system
        files: \.sol$
        
      - id: solhint
        name: Solhint Linter
        entry: solhint
        language: system
        files: \.sol$
```

### 3. Automated Reporting

```python
#!/usr/bin/env python3
"""
Aggregate security tool results into unified report
"""

import json
import glob
from pathlib import Path

def aggregate_results():
    report = {
        "slither": parse_slither_results(),
        "mythril": parse_mythril_results(),
        "echidna": parse_echidna_results()
    }
    
    # Generate markdown report
    generate_markdown_report(report)
    
    # Check for critical issues
    return check_critical_issues(report)

def parse_slither_results():
    with open('reports/slither-report.json', 'r') as f:
        return json.load(f)

def generate_markdown_report(report):
    with open('security-report.md', 'w') as f:
        f.write("# Security Analysis Report\n\n")
        # Write aggregated findings
```

### 4. Tool Combination Strategy

```makefile
# Makefile for comprehensive analysis
.PHONY: security-quick security-deep security-formal

security-quick:
	@echo "Running quick security scan..."
	@slither . --fail-high
	@myth analyze contracts/critical/*.sol --quick

security-deep:
	@echo "Running deep security analysis..."
	@slither . --print human-summary
	@myth analyze contracts/**/*.sol -t 5 --max-depth 22
	@echidna-test . --contract TestSuite --testLimit 100000

security-formal:
	@echo "Running formal verification..."
	@certoraRun --conf certora.conf
```

## Tool Limitations

### What Automated Tools Cannot Catch

1. **Business Logic Flaws**
   - Incorrect implementations of specifications
   - Missing access controls in context
   - Economic/game theory vulnerabilities

2. **Cross-Contract Dependencies**
   - Complex interactions between multiple contracts
   - Composability issues
   - Oracle manipulation vulnerabilities

3. **Timing and Ordering Issues**
   - MEV vulnerabilities
   - Front-running opportunities
   - Time-dependent logic flaws

4. **External Dependencies**
   - Oracle trust assumptions
   - Third-party contract risks
   - Upgradability trust issues

5. **Economic Attacks**
   - Flash loan attack vectors
   - Liquidity manipulation
   - Governance attacks

### Manual Review Requirements

Areas requiring human expertise:

1. **Architecture Review**
   - System design evaluation
   - Trust model assessment
   - Upgrade mechanism safety

2. **Economic Model Analysis**
   - Token economics
   - Incentive structures
   - Game theory considerations

3. **Integration Testing**
   - Cross-protocol interactions
   - Fork testing with mainnet state
   - Scenario-based testing

## Practical Workflows

### 1. Initial Assessment Workflow

```bash
# Step 1: Quick scan for obvious issues
slither . --print human-summary

# Step 2: Check for common vulnerabilities
myth analyze contracts/core/*.sol --quick

# Step 3: Generate visualization
surya graph contracts/core/*.sol | dot -Tpng > architecture.png

# Step 4: Run basic fuzzing
echidna-test . --contract QuickTest --testLimit 10000
```

### 2. Deep Dive Workflow

```bash
# Step 1: Comprehensive static analysis
slither . --print all

# Step 2: Symbolic execution with high depth
myth analyze contracts/**/*.sol -t 5 --max-depth 22

# Step 3: Extended fuzzing campaign
echidna-test . --config deep-echidna.yaml --testLimit 1000000

# Step 4: Formal verification of critical properties
certoraRun --conf certora.conf
```

### 3. Pre-Deployment Checklist

- [ ] All high-severity Slither issues resolved
- [ ] Mythril deep scan completed (no high severity)
- [ ] Echidna invariants hold for 1M+ tests
- [ ] Critical properties formally verified
- [ ] 100% test coverage on critical paths
- [ ] Gas optimization analysis completed
- [ ] External audit scheduled/completed

### 4. Continuous Monitoring

```javascript
// Monitor script for deployed contracts
const monitorContract = async (address) => {
  // Check for new vulnerabilities
  await runSlitherOnDeployed(address);
  
  // Monitor for unusual activity
  await checkForAnomalousTransactions(address);
  
  // Verify invariants still hold
  await runInvariantChecks(address);
};
```

## Best Practices

1. **Layer Your Analysis**
   - Start with fast tools (Slither)
   - Progress to deeper analysis (Mythril)
   - Add fuzzing for edge cases (Echidna)
   - Formal verification for critical properties

2. **Automate Everything**
   - CI/CD integration
   - Pre-commit hooks
   - Automated reporting
   - Continuous monitoring

3. **Focus on High-Value Targets**
   - Money handling functions
   - Access control mechanisms
   - Upgrade functions
   - External calls

4. **Document Security Assumptions**
   - Trust boundaries
   - External dependencies
   - Threat model
   - Known limitations

5. **Maintain Security Artifacts**
   - Keep tool configurations in version control
   - Document security decisions
   - Track vulnerability remediation
   - Update threat models regularly

## Conclusion

Effective smart contract security requires a multi-layered approach combining automated tools with manual expertise. No single tool can catch all vulnerabilities, but proper integration and workflow design can significantly reduce risk. Regular updates to tools and techniques are essential as the threat landscape evolves.