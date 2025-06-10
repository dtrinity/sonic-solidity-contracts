# Mythril Security Analysis Tools

This directory contains improved tooling for running Mythril security analysis on Solidity contracts with enhanced features for efficiency and usability.

## Scripts

### `run_mythril.py`

The main script that provides comprehensive mythril security analysis with the following features:

- **Parallel execution** for faster analysis
- **Exclusion of already analyzed contracts** to avoid redundant work
- **Shared core logic** for single contract analysis
- **Automatic summary generation** at the end
- **Support for focused analysis** on specific contracts

#### Usage

```bash
# Basic usage - analyze all contracts
./scripts/mythril/run_mythril.py

# Focused analysis on a specific contract
./scripts/mythril/run_mythril.py --contract contracts/common/BasisPointConstants.sol

# Fast parallel analysis with more workers
./scripts/mythril/run_mythril.py --max-workers 8 --timeout 60

# Force re-analysis of all contracts (ignoring existing results)
./scripts/mythril/run_mythril.py --force-reanalyze

# Deep analysis with extended parameters
./scripts/mythril/run_mythril.py --contract contracts/example.sol --timeout 600 -t 10 --max-depth 20 --call-depth-limit 8
```

#### Command Line Options

- `--contract CONTRACT`: Specific contract to analyze (focused mode)
- `--timeout TIMEOUT`: Analysis timeout per contract in seconds (default: 120)
- `--max-workers MAX_WORKERS`: Number of parallel workers (default: 4)
- `--max-depth MAX_DEPTH`: Maximum analysis depth
- `--call-depth-limit CALL_DEPTH_LIMIT`: Maximum call depth
- `-t, --transaction-count TRANSACTION_COUNT`: Number of transactions to analyze
- `--skip-compilation`: Skip contract compilation
- `--force-reanalyze`: Reanalyze even if results exist
- `--no-summary`: Skip summary generation

### `generate_summary.py`

Script to compile all JSON files from `reports/mythril` and generate a comprehensive markdown summary.

#### Usage

```bash
./scripts/mythril/generate_summary.py
```

This generates a summary at `reports/mythril_summary.md` with:
- Overview statistics
- Categorized results (Success, Compilation Errors, etc.)
- Detailed issue information
- Recommendations for addressing common issues

## Makefile Targets

The following make targets are available for convenience:

### Primary Targets

- `make mythril`: Run standard mythril analysis on all contracts
- `make mythril.focused contract=<path>`: Run focused analysis on a specific contract
- `make mythril.deep contract=<path>`: Run deep analysis with extended parameters

### Enhanced Targets

- `make mythril.fast`: Run fast parallel analysis with 8 workers and reduced timeout
- `make mythril.force`: Force re-analysis of all contracts (ignoring existing results)
- `make mythril.summary`: Generate summary from existing results without running analysis

### Examples

```bash
# Standard analysis
make mythril

# Analyze a specific contract
make mythril.focused contract=contracts/common/BasisPointConstants.sol

# Deep analysis of a complex contract
make mythril.deep contract=contracts/vaults/dloop/core/DLoopCore.sol

# Fast parallel analysis
make mythril.fast

# Force re-analysis of everything
make mythril.force

# Just generate summary from existing results
make mythril.summary
```

## Features

### Smart Contract Discovery

The script automatically finds Solidity contracts while excluding:
- Mock contracts (`*/mocks/*`)
- Testing contracts (`*/testing/*`)
- Dependencies (`*/dependencies/*`)
- DLend contracts (`*/dlend/*`)
- Interface files (`*/interface/*`, `*/interfaces/*`)
- Abstract contracts (containing `abstract contract`)
- Interface contracts (filename starting with `I` + uppercase)

### Parallel Execution

Analysis runs in parallel using ThreadPoolExecutor with configurable worker count:
- Default: 4 workers
- Fast mode: 8 workers
- Customizable with `--max-workers`

### Incremental Analysis

The script tracks already analyzed contracts and skips them by default:
- Checks for existing JSON files in `reports/mythril/`
- Skips contracts that have already been analyzed
- Use `--force-reanalyze` to override this behavior

### Robust Error Handling

- Handles compilation errors gracefully
- Manages analysis timeouts
- Captures and reports exceptions
- Creates appropriate result files for all scenarios

### Output Management

- Saves all results as JSON files in `reports/mythril/`
- Creates error logs for debugging failed analyses
- Generates comprehensive markdown summaries
- Thread-safe output for parallel execution

## Output Structure

### Individual Results

Each contract analysis produces a JSON file at:
```
reports/mythril/<ContractName>.json
```

### Summary Report

The summary is generated at:
```
reports/mythril_summary.md
```

### Error Logs

For contracts that fail analysis, additional debug files are created:
```
reports/mythril/<ContractName>_error.txt
```

## Tips for Effective Usage

1. **Start with fast mode** to get a quick overview: `make mythril.fast`
2. **Use focused analysis** for specific contracts you're working on
3. **Check the summary** regularly to track analysis progress
4. **Use force mode** when contract changes require re-analysis
5. **Increase timeout** for complex contracts that need more analysis time

## Troubleshooting

### Common Issues

1. **Compilation Errors**: Usually due to missing dependencies or version mismatches
   - Check that all dependencies are properly installed
   - Verify Solidity version requirements

2. **Stack Too Deep**: Some contracts may hit Solidity's stack limit
   - Enable optimizer in hardhat config
   - Consider using `--via-ir` flag

3. **Timeouts**: Complex contracts may exceed analysis timeout
   - Increase timeout with `--timeout` parameter
   - Use focused analysis for individual contracts

4. **Memory Issues**: Large parallel analysis may consume significant memory
   - Reduce `--max-workers` if experiencing memory pressure
   - Analyze contracts in smaller batches

### Performance Tuning

- **For speed**: Use `--max-workers 8` and lower `--timeout`
- **For thoroughness**: Use higher `--timeout`, `--max-depth`, and `--transaction-count`
- **For debugging**: Use `--contract` for focused analysis with verbose output

## Integration

This tooling integrates seamlessly with the existing build system:
- Uses the same `mythril-config.json` configuration
- Leverages hardhat compilation
- Follows existing directory structure and naming conventions 