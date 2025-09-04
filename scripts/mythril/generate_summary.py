#!/usr/bin/env python3
"""
Script to compile all JSON files from reports/mythril and generate a summary table in markdown.
This script handles malformed JSON files that contain extra text before the actual JSON content.
"""

import json
import os
import re
from pathlib import Path
from typing import Dict, Any, List, Tuple


def extract_json_from_file(file_path: str) -> Tuple[Dict[str, Any], str]:
    """
    Extract JSON content from a file that may contain extra text.
    
    Args:
        file_path: Path to the file to parse
        
    Returns:
        Tuple of (parsed_json_dict, error_message)
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Find the JSON content by looking for the first '{' and last '}'
        json_start = content.find('{')
        if json_start == -1:
            return {}, "No JSON content found"
        
        json_end = content.rfind('}')
        if json_end == -1:
            return {}, "No valid JSON end found"
        
        json_content = content[json_start:json_end + 1]
        
        # Parse the JSON
        parsed = json.loads(json_content)
        return parsed, ""
        
    except json.JSONDecodeError as e:
        return {}, f"JSON decode error: {str(e)}"
    except Exception as e:
        return {}, f"Error reading file: {str(e)}"


def categorize_result(result: Dict[str, Any]) -> str:
    """
    Categorize the mythril analysis result.
    
    Args:
        result: Parsed JSON result from mythril
        
    Returns:
        Category string
    """
    if not result:
        return "Parse Error"
    
    success = result.get('success', False)
    error = result.get('error')
    issues = result.get('issues', [])
    
    if not success and error:
        if "Solc experienced a fatal error" in error:
            return "Compilation Error"
        elif "ParserError" in error:
            return "Parser Error"
        elif "SolidityVersionMismatch" in error:
            return "Version Mismatch"
        else:
            return "Analysis Error"
    elif success and not issues:
        return "Success (No Issues)"
    elif success and issues:
        return f"Success ({len(issues)} Issues)"
    else:
        return "Unknown"


def truncate_error(error: str, max_length: int = 100) -> str:
    """
    Truncate error message for display in table.
    
    Args:
        error: Error message to truncate
        max_length: Maximum length of the truncated message
        
    Returns:
        Truncated error message
    """
    if not error or len(error) <= max_length:
        return error
    
    return error[:max_length] + "..."


def generate_summary_table(mythril_dir: str) -> str:
    """
    Generate a formatted markdown document for all JSON files in the mythril directory.
    
    Args:
        mythril_dir: Path to the directory containing mythril JSON files
        
    Returns:
        Markdown formatted summary document
    """
    results = []
    
    # Get all JSON files
    json_files = sorted([f for f in os.listdir(mythril_dir) if f.endswith('.json')])
    
    for json_file in json_files:
        file_path = os.path.join(mythril_dir, json_file)
        contract_name = json_file.replace('.json', '')
        
        result, parse_error = extract_json_from_file(file_path)
        
        if parse_error:
            category = "Parse Error"
            error_msg = parse_error
            issue_count = "N/A"
        else:
            category = categorize_result(result)
            error_msg = result.get('error', '')
            issues = result.get('issues', [])
            issue_count = len(issues) if isinstance(issues, list) else "N/A"
        
        results.append({
            'contract': contract_name,
            'category': category,
            'issue_count': issue_count,
            'error': error_msg,
            'full_result': result
        })
    
    # Generate formatted markdown document
    markdown = "# Mythril Analysis Summary\n\n"
    markdown += f"**Total contracts analyzed:** {len(results)}\n\n"
    
    # Count by category
    categories = {}
    for result in results:
        cat = result['category']
        categories[cat] = categories.get(cat, 0) + 1
    
    markdown += "## Overview\n\n"
    for category, count in sorted(categories.items()):
        percentage = (count / len(results)) * 100
        markdown += f"- **{category}**: {count} contracts ({percentage:.1f}%)\n"
    
    # Group results by category
    grouped_results = {}
    for result in results:
        category = result['category']
        if category not in grouped_results:
            grouped_results[category] = []
        grouped_results[category].append(result)
    
    # Generate sections for each category
    for category in sorted(grouped_results.keys()):
        contracts = grouped_results[category]
        markdown += f"\n## {category}\n\n"
        markdown += f"*{len(contracts)} contract(s)*\n\n"
        
        for contract in sorted(contracts, key=lambda x: x['contract']):
            markdown += f"### {contract['contract']}\n\n"
            
            if contract['category'].startswith('Success'):
                if contract['issue_count'] == 0:
                    markdown += "✅ **Status**: Analysis completed successfully with no issues found.\n\n"
                else:
                    markdown += f"⚠️ **Status**: Analysis completed with **{contract['issue_count']} security issues** found.\n\n"
                    # If there are issues, we could expand this to show them
                    if contract['full_result'].get('issues'):
                        markdown += "**Issues found:**\n"
                        for i, issue in enumerate(contract['full_result']['issues'], 1):
                            title = issue.get('title', 'Unknown Issue')
                            severity = issue.get('severity', 'Unknown')
                            markdown += f"{i}. **{title}** (Severity: {severity})\n"
                        markdown += "\n"
            
            elif contract['category'] in ['Compilation Error', 'Parser Error', 'Version Mismatch', 'Analysis Error']:
                markdown += f"❌ **Status**: {contract['category']}\n\n"
                if contract['error']:
                    markdown += "**Error Details:**\n```\n"
                    markdown += contract['error']
                    markdown += "\n```\n\n"
            
            elif contract['category'] == 'Parse Error':
                markdown += "❌ **Status**: Failed to parse analysis results\n\n"
                if contract['error']:
                    markdown += f"**Error**: {contract['error']}\n\n"
            
            else:
                markdown += f"❓ **Status**: {contract['category']}\n\n"
                if contract['error']:
                    markdown += f"**Details**: {contract['error']}\n\n"
    
    # Add recommendations section
    markdown += "## Recommendations\n\n"
    
    if 'Compilation Error' in categories:
        compilation_errors = categories['Compilation Error']
        markdown += f"### Compilation Issues ({compilation_errors} contracts)\n\n"
        markdown += "Several contracts failed to compile. Common issues and solutions:\n\n"
        markdown += "- **Stack too deep errors**: Add `--via-ir` flag when compiling or enable optimizer\n"
        markdown += "- **Missing dependencies**: Ensure all OpenZeppelin contracts are properly installed\n"
        markdown += "- **Version mismatches**: Check Solidity version requirements in pragma statements\n\n"
    
    if 'Success (No Issues)' in categories:
        success_count = categories['Success (No Issues)']
        markdown += f"### Successfully Analyzed ({success_count} contracts)\n\n"
        markdown += "These contracts compiled and analyzed successfully with no security issues detected by Mythril.\n\n"
    
    # Add summary of analysis types that found issues
    issue_contracts = [r for r in results if r['category'].startswith('Success (') and r['issue_count'] > 0]
    if issue_contracts:
        markdown += f"### Security Issues Found ({len(issue_contracts)} contracts)\n\n"
        markdown += "Review the detailed results above for specific security issues that need attention.\n\n"
    
    markdown += "---\n\n"
    markdown += f"*Report generated on {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n"
    
    return markdown


def main():
    """Main function to generate and save the summary."""
    # Get the script directory and calculate paths
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    mythril_dir = repo_root / "reports" / "mythril"
    output_file = repo_root / "reports" / "mythril_summary.md"
    
    if not mythril_dir.exists():
        print(f"Error: Mythril directory not found at {mythril_dir}")
        return
    
    print(f"Analyzing JSON files in: {mythril_dir}")
    
    # Generate the summary
    summary = generate_summary_table(str(mythril_dir))
    
    # Write to file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(summary)
    
    print(f"Summary generated and saved to: {output_file}")
    print("\n" + "="*50)
    print(summary)


if __name__ == "__main__":
    main() 