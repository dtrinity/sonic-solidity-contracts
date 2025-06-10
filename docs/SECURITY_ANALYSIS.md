# Security Analysis Tools

This document describes the security analysis tools available in this project, including Slither and Mythril.

## Overview

The project includes comprehensive security analysis tools to help identify potential vulnerabilities in smart contracts:

- **Slither**: Static analysis tool for Solidity
- **Mythril**: Symbolic execution-based security analysis tool

## Mythril Setup

Mythril is installed via pipx and provides symbolic execution-based security analysis for EVM bytecode.

### Installation

Mythril is already set up in the project. If you need to install it manually:

```bash
# Install pipx if not already installed
brew install pipx

# Install Mythril
pipx install mythril
```

### Available Commands

#### Basic Commands

- `make mythril.version` - Show Mythril version
- `make mythril.list-detectors` - List all available security detectors
- `make mythril.test` - Test Mythril on a simple contract
- `make mythril.clean` - Clean all Mythril report files

#### Analysis Commands

- `make mythril.quick` - Quick analysis on core contracts (5 contracts, 60s timeout)
- `make mythril` - Full analysis on all contracts (10 contracts, 120s timeout)
- `make mythril.focused contract=<path>` - Analyze specific contract with detailed output
- `make mythril.deep contract=<path>` - Deep analysis with extended parameters (600s timeout)

#### Module-Specific Analysis

- `make mythril.dlend` - Analyze dlend core contracts
- `make mythril.vaults` - Analyze vault contracts

#### Combined Security Analysis

- `make security` - Run Slither + quick Mythril analysis
- `make security.full` - Run Slither + full Mythril analysis

## Usage Examples

### Quick Security Check
```bash
# Run quick security analysis (recommended for regular checks)
make security
```

### Analyze Specific Contract
```bash
# Analyze a specific contract with detailed output
make mythril.focused contract=contracts/dlend/core/protocol/pool/Pool.sol
```

### Deep Analysis
```bash
# Run deep analysis on a critical contract
make mythril.deep contract=contracts/dlend/core/protocol/pool/Pool.sol
```

### Module-Specific Analysis
```bash
# Analyze all dlend contracts
make mythril.dlend

# Analyze all vault contracts
make mythril.vaults
```

## Report Locations

All Mythril reports are saved in the `reports/mythril/` directory:

- `reports/mythril/` - General analysis reports
- `reports/mythril/dlend/` - Dlend-specific reports
- `reports/mythril/vaults/` - Vault-specific reports

## Security Detectors

Mythril includes the following security detectors:

- **AccidentallyKillable**: Contract can be accidentally killed by anyone
- **ArbitraryJump**: Caller can redirect execution to arbitrary bytecode locations
- **ArbitraryStorage**: Caller can write to arbitrary storage locations
- **ArbitraryDelegateCall**: Delegatecall to a user-specified address
- **EtherThief**: Any sender can withdraw ETH from the contract account
- **Exceptions**: Assertion violation
- **ExternalCalls**: External call to another contract
- **IntegerArithmetics**: Integer overflow or underflow
- **MultipleSends**: Multiple external calls in the same transaction
- **PredictableVariables**: Control flow depends on a predictable environment variable
- **RequirementsViolation**: Requirement Violation
- **StateChangeAfterCall**: State change after an external call
- **TransactionOrderDependence**: Transaction Order Dependence
- **TxOrigin**: Control flow depends on tx.origin
- **UncheckedRetval**: Return value of an external call is not checked
- **UnexpectedEther**: Unexpected Ether Balance
- **UserAssertions**: A user-defined assertion has been triggered

## Best Practices

1. **Regular Analysis**: Run `make security` regularly during development
2. **Pre-deployment**: Always run `make security.full` before deploying to mainnet
3. **Critical Contracts**: Use `make mythril.deep` for critical contracts
4. **Review Reports**: Always review generated reports in `reports/mythril/`
5. **Clean Reports**: Use `make mythril.clean` to clean old reports before new analysis

## Troubleshooting

### Common Issues

1. **Dependency Resolution**: Some contracts with complex dependencies may not analyze properly. Use simpler contracts or the test command first.

2. **Timeout Issues**: If analysis times out, try:
   - Use `mythril.quick` instead of full analysis
   - Analyze contracts individually with `mythril.focused`
   - Increase timeout in Makefile if needed

3. **Memory Issues**: For large contracts, consider:
   - Using `mythril.quick` for initial analysis
   - Breaking down analysis by modules (dlend, vaults, etc.)

### Getting Help

- Check Mythril documentation: https://mythril-classic.readthedocs.io/
- List available detectors: `make mythril.list-detectors`
- Test on simple contracts: `make mythril.test`

## Integration with CI/CD

For continuous integration, consider adding security analysis to your pipeline:

```yaml
# Example GitHub Actions step
- name: Security Analysis
  run: |
    make security
    # Upload reports as artifacts
```

## Slither Integration

This project also includes Slither static analysis. See the main Makefile for Slither commands:

- `make slither` - Run Slither analysis
- `make slither.check` - Run with strict checks
- `make slither.focused contract=<path>` - Analyze specific contract

Both tools complement each other and should be used together for comprehensive security analysis. 