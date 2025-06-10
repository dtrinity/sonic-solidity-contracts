#!/usr/bin/env python3
"""
Mythril Security Analysis Runner

This script provides comprehensive mythril security analysis with the following features:
- Parallel execution for faster analysis
- Exclusion of already analyzed contracts
- Shared core logic for single contract analysis
- Automatic summary generation at the end
- Support for focused analysis on specific contracts
"""

import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Set, Optional, Dict, Any
import threading

# Thread-safe printing
print_lock = threading.Lock()

def safe_print(message: str, flush: bool = True):
    """Thread-safe print function."""
    try:
        with print_lock:
            print(message, flush=flush)
    except BrokenPipeError:
        # Handle broken pipe gracefully (e.g., when output is piped to head)
        pass

class MythrilRunner:
    def __init__(self, repo_root: Path, max_workers: int = 4):
        self.repo_root = repo_root
        self.reports_dir = repo_root / "reports" / "mythril"
        self.max_workers = max_workers
        self.reports_dir.mkdir(parents=True, exist_ok=True)
    
    def get_all_contracts(self) -> List[Path]:
        """Get all Solidity contracts to analyze."""
        contracts_dir = self.repo_root / "contracts"
        
        # Exclude patterns from the original Makefile
        exclude_patterns = [
            "*/mocks/*",
            "*/testing/*", 
            "*/dependencies/*",
            "*/dlend/*",
            "*/interface/*",
            "*/interfaces/*"
        ]
        
        # Additional patterns to exclude mock and test contracts
        exclude_filename_patterns = [
            "Mock",
            "mock", 
            "Test",
            "test",
            "Fake",
            "fake"
        ]
        
        all_contracts = []
        for sol_file in contracts_dir.rglob("*.sol"):
            # Check if file matches any exclude pattern
            relative_path = sol_file.relative_to(self.repo_root)
            should_exclude = False
            
            # Check path patterns
            for pattern in exclude_patterns:
                if any(part in pattern.replace("*", "") for part in relative_path.parts):
                    should_exclude = True
                    break
            
            # Check filename patterns for mock/test contracts
            if not should_exclude:
                filename = sol_file.stem
                for pattern in exclude_filename_patterns:
                    if pattern in filename:
                        should_exclude = True
                        break
            
            if not should_exclude:
                # Skip abstract contracts and interfaces
                try:
                    with open(sol_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                        if "abstract contract" in content:
                            continue
                        # Skip interface files (starting with I and uppercase)
                        filename = sol_file.stem
                        if filename.startswith('I') and len(filename) > 1 and filename[1].isupper():
                            continue
                except Exception:
                    continue
                
                all_contracts.append(sol_file)
        
        return sorted(all_contracts)
    
    def get_analyzed_contracts(self) -> Set[str]:
        """Get set of contracts that have already been successfully analyzed."""
        analyzed = set()
        if self.reports_dir.exists():
            for json_file in self.reports_dir.glob("*.json"):
                contract_name = json_file.stem
                
                # Check if the analysis was successful by examining the JSON content
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                        
                    # Try to parse as JSON
                    data = json.loads(content)
                    
                    # If it has 'success': False, it was a failed analysis we created
                    if isinstance(data, dict) and data.get('success') is False:
                        continue  # Skip failed analyses - they should be re-run
                    
                    # If it has 'error' key with an actual error message, it was a failed analysis we created
                    if isinstance(data, dict) and data.get('error') and data.get('error') != None:
                        continue  # Skip failed analyses - they should be re-run
                    
                    # If we get here, it's likely a successful mythril output
                    # (either has success: true, or error: null, or is standard mythril JSON with issues array)
                    analyzed.add(contract_name)
                    
                except (json.JSONDecodeError, FileNotFoundError, Exception):
                    # If we can't parse the JSON or read the file, treat as failed analysis
                    # and let it be re-run
                    continue
                    
        return analyzed
    
    def analyze_single_contract(self, contract_path: Path, timeout: int = 120, 
                              max_depth: Optional[int] = None, 
                              call_depth_limit: Optional[int] = None,
                              transaction_count: Optional[int] = None) -> Dict[str, Any]:
        """
        Analyze a single contract with mythril.
        
        Args:
            contract_path: Path to the contract file
            timeout: Analysis timeout in seconds
            max_depth: Maximum analysis depth
            call_depth_limit: Maximum call depth
            transaction_count: Number of transactions to analyze
            
        Returns:
            Dictionary with analysis results
        """
        contract_name = contract_path.stem
        output_file = self.reports_dir / f"{contract_name}.json"
        
        safe_print(f"🔍 Analyzing {contract_path.relative_to(self.repo_root)}...")
        
        # Build mythril command
        cmd = [
            "myth", "analyze", str(contract_path),
            "--execution-timeout", str(timeout),
            "--solv", "0.8.20",
            "--solc-json", str(self.repo_root / "mythril-config.json"),
            "-o", "json"
        ]
        
        # Add optional parameters
        if max_depth:
            cmd.extend(["--max-depth", str(max_depth)])
        if call_depth_limit:
            cmd.extend(["--call-depth-limit", str(call_depth_limit)])
        if transaction_count:
            cmd.extend(["-t", str(transaction_count)])
        
        start_time = time.time()
        
        try:
            # Run mythril analysis
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout + 30  # Give extra time for process cleanup
            )
            
            analysis_time = time.time() - start_time
            
            # Save output to file
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(result.stdout)
            
            # Determine status
            if result.returncode == 0:
                status = "✅ Success"
                try:
                    # Try to parse JSON to check for issues
                    output_data = json.loads(result.stdout)
                    issue_count = len(output_data.get('issues', []))
                    if issue_count > 0:
                        status = f"⚠️  Success ({issue_count} issues)"
                except json.JSONDecodeError:
                    status = "✅ Success (no JSON output)"
            else:
                status = "❌ Error"
                if result.stderr:
                    # Also write stderr to a separate file for debugging
                    error_file = self.reports_dir / f"{contract_name}_error.txt"
                    with open(error_file, 'w', encoding='utf-8') as f:
                        f.write(f"STDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}")
            
            safe_print(f"   {status} - {contract_name} ({analysis_time:.1f}s)")
            
            return {
                'contract': contract_name,
                'path': str(contract_path.relative_to(self.repo_root)),
                'status': 'success' if result.returncode == 0 else 'error',
                'analysis_time': analysis_time,
                'output_file': str(output_file.relative_to(self.repo_root))
            }
            
        except subprocess.TimeoutExpired:
            safe_print(f"   ⏰ Timeout - {contract_name} (>{timeout}s)")
            # Create a timeout result file
            timeout_result = {
                'success': False,
                'error': f'Analysis timed out after {timeout} seconds',
                'issues': []
            }
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(timeout_result, f, indent=2)
            
            return {
                'contract': contract_name,
                'path': str(contract_path.relative_to(self.repo_root)),
                'status': 'timeout',
                'analysis_time': timeout,
                'output_file': str(output_file.relative_to(self.repo_root))
            }
            
        except Exception as e:
            safe_print(f"   💥 Exception - {contract_name}: {str(e)}")
            # Create an error result file
            error_result = {
                'success': False,
                'error': f'Exception during analysis: {str(e)}',
                'issues': []
            }
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(error_result, f, indent=2)
            
            return {
                'contract': contract_name,
                'path': str(contract_path.relative_to(self.repo_root)),
                'status': 'exception',
                'analysis_time': 0,
                'output_file': str(output_file.relative_to(self.repo_root))
            }
    
    def run_batch_analysis(self, contracts: List[Path], skip_analyzed: bool = True, 
                         timeout: int = 120, **analysis_options) -> List[Dict[str, Any]]:
        """
        Run mythril analysis on multiple contracts in parallel.
        
        Args:
            contracts: List of contract paths to analyze
            skip_analyzed: Whether to skip already analyzed contracts
            timeout: Analysis timeout per contract
            **analysis_options: Additional options for analysis
            
        Returns:
            List of analysis results
        """
        if skip_analyzed:
            analyzed = self.get_analyzed_contracts()
            contracts_to_analyze = [
                c for c in contracts 
                if c.stem not in analyzed
            ]
            skipped_count = len(contracts) - len(contracts_to_analyze)
            if skipped_count > 0:
                safe_print(f"📋 Skipping {skipped_count} already analyzed contracts")
        else:
            contracts_to_analyze = contracts
        
        if not contracts_to_analyze:
            safe_print("✨ All contracts already analyzed!")
            return []
        
        safe_print(f"🚀 Starting analysis of {len(contracts_to_analyze)} contracts with {self.max_workers} workers...")
        
        results = []
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit all analysis tasks
            future_to_contract = {
                executor.submit(
                    self.analyze_single_contract, 
                    contract, 
                    timeout, 
                    **analysis_options
                ): contract 
                for contract in contracts_to_analyze
            }
            
            # Collect results as they complete
            for future in as_completed(future_to_contract):
                contract = future_to_contract[future]
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    safe_print(f"💥 Failed to analyze {contract.stem}: {str(e)}")
                    results.append({
                        'contract': contract.stem,
                        'path': str(contract.relative_to(self.repo_root)),
                        'status': 'failed',
                        'analysis_time': 0,
                        'error': str(e)
                    })
        
        return results
    
    def generate_summary(self):
        """Generate analysis summary using the existing script."""
        safe_print("\n📊 Generating analysis summary...")
        try:
            summary_script = self.repo_root / "scripts" / "mythril" / "generate_summary.py"
            result = subprocess.run([sys.executable, str(summary_script)], 
                                  capture_output=True, text=True)
            if result.returncode == 0:
                safe_print("✅ Summary generated successfully!")
            else:
                safe_print(f"❌ Summary generation failed: {result.stderr}")
        except Exception as e:
            safe_print(f"💥 Exception generating summary: {str(e)}")


def compile_contracts(repo_root: Path) -> bool:
    """Compile contracts before analysis."""
    safe_print("🔨 Compiling contracts...")
    try:
        result = subprocess.run(
            ["yarn", "hardhat", "compile"],
            cwd=repo_root,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            safe_print("✅ Compilation successful!")
            return True
        else:
            safe_print(f"❌ Compilation failed: {result.stderr}")
            return False
    except Exception as e:
        safe_print(f"💥 Compilation exception: {str(e)}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Run Mythril security analysis")
    parser.add_argument("--contract", help="Specific contract to analyze (focused mode)")
    parser.add_argument("--timeout", type=int, default=120, help="Analysis timeout per contract (seconds)")
    parser.add_argument("--max-workers", type=int, default=4, help="Number of parallel workers")
    parser.add_argument("--max-depth", type=int, help="Maximum analysis depth")
    parser.add_argument("--call-depth-limit", type=int, help="Maximum call depth")
    parser.add_argument("-t", "--transaction-count", type=int, help="Number of transactions to analyze")
    parser.add_argument("--skip-compilation", action="store_true", help="Skip contract compilation")
    parser.add_argument("--force-reanalyze", action="store_true", help="Reanalyze even if results exist")
    parser.add_argument("--no-summary", action="store_true", help="Skip summary generation")
    
    args = parser.parse_args()
    
    # Get repository root (script is in scripts/mythril/)
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    
    safe_print("🛡️  Mythril Security Analysis Runner")
    safe_print("=" * 50)
    
    # Compile contracts unless skipped
    if not args.skip_compilation:
        if not compile_contracts(repo_root):
            safe_print("❌ Stopping due to compilation failure")
            return 1
    
    # Initialize runner
    runner = MythrilRunner(repo_root, max_workers=args.max_workers)
    
    # Analysis options
    analysis_options = {}
    if args.max_depth:
        analysis_options['max_depth'] = args.max_depth
    if args.call_depth_limit:
        analysis_options['call_depth_limit'] = args.call_depth_limit
    if args.transaction_count:
        analysis_options['transaction_count'] = args.transaction_count
    
    start_time = time.time()
    
    if args.contract:
        # Focused mode - analyze specific contract
        safe_print(f"🎯 Focused analysis mode: {args.contract}")
        contract_path = repo_root / args.contract
        
        if not contract_path.exists():
            safe_print(f"❌ Contract not found: {contract_path}")
            return 1
        
        result = runner.analyze_single_contract(
            contract_path, 
            timeout=args.timeout,
            **analysis_options
        )
        
        safe_print(f"\n✨ Analysis completed: {result['status']}")
        
    else:
        # Batch mode - analyze all contracts
        safe_print("📦 Batch analysis mode")
        contracts = runner.get_all_contracts()
        safe_print(f"📋 Found {len(contracts)} contracts to consider")
        
        results = runner.run_batch_analysis(
            contracts,
            skip_analyzed=not args.force_reanalyze,
            timeout=args.timeout,
            **analysis_options
        )
        
        if results:
            # Print summary
            total_time = time.time() - start_time
            successful = len([r for r in results if r['status'] == 'success'])
            errors = len([r for r in results if r['status'] == 'error'])
            timeouts = len([r for r in results if r['status'] == 'timeout'])
            
            safe_print(f"\n📊 Analysis Summary:")
            safe_print(f"   Total analyzed: {len(results)}")
            safe_print(f"   Successful: {successful}")
            safe_print(f"   Errors: {errors}")
            safe_print(f"   Timeouts: {timeouts}")
            safe_print(f"   Total time: {total_time:.1f}s")
    
    # Generate summary unless disabled
    if not args.no_summary:
        runner.generate_summary()
    
    safe_print("\n🎉 Analysis complete!")
    return 0


if __name__ == "__main__":
    sys.exit(main()) 