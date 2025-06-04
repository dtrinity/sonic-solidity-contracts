#!/bin/bash

# Script to calculate nSLOC (normalized Source Lines of Code) for all Solidity files in contracts/
# Uses solidity-code-metrics via npx
# Outputs to nsloc.md by default

set -e

# Default output file
OUTPUT_FILE="${1:-nsloc.md}"

# Check if contracts directory exists
if [ ! -d "contracts" ]; then
    echo "Error: contracts/ directory not found"
    exit 1
fi

# Function to process a single file
process_file() {
    local file="$1"
    
    # Run solidity-code-metrics on the file and extract nSLOC
    # The tool outputs markdown, so we need to parse it
    output=$(npx solidity-code-metrics "$file" 2>/dev/null || echo "Error processing $file")
    
    # Extract nSLOC from the output - look for the table row with the file name
    # The nSLOC is in the 8th column (index 8 when split by |)
    nsloc=$(echo "$output" | grep "| $file |" | head -1 | awk -F'|' '{gsub(/[[:space:]]/, "", $8); print $8}')
    
    # If we couldn't find it in the expected format, try alternative parsing
    if [ -z "$nsloc" ] || [ "$nsloc" = "" ]; then
        # Try to find any line with the filename and extract nSLOC (8th column)
        nsloc=$(echo "$output" | grep "$file" | grep -E "\|.*\|.*\|.*\|.*\|.*\|.*\|.*\|" | head -1 | awk -F'|' '{gsub(/[[:space:]]/, "", $8); print $8}')
    fi
    
    # If still empty, mark as N/A
    if [ -z "$nsloc" ] || [ "$nsloc" = "" ]; then
        nsloc="N/A"
    fi
    
    printf "%-60s | %s\n" "$file" "$nsloc"
}

# Export the function so it can be used by xargs
export -f process_file

# Count total files first
total_files=$(find contracts -name "*.sol" -type f | wc -l)

echo "Calculating nSLOC for $total_files Solidity files in contracts/..."
echo "Using parallel processing for faster execution..."
echo "Output will be saved to: $OUTPUT_FILE"
echo ""

# Create header for the output file
{
    echo "# nSLOC (normalized Source Lines of Code) Report"
    echo ""
    echo "Generated on: $(date)"
    echo "Total files processed: $total_files"
    echo ""
    echo "| File Path | nSLOC |"
    echo "|-----------|-------|"
} > "$OUTPUT_FILE"

# Use find with xargs to process files in parallel
# Determine number of parallel jobs (use number of CPU cores)
num_jobs=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "4")

echo "Processing files using $num_jobs parallel jobs..."

# Process files in parallel and append to output file
find contracts -name "*.sol" -type f | sort | xargs -n 1 -P "$num_jobs" -I {} bash -c 'process_file "$@"' _ {} >> "$OUTPUT_FILE"

echo ""
echo "Done! Results saved to $OUTPUT_FILE"
echo "Processed $total_files files using $num_jobs parallel jobs."
