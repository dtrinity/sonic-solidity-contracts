#!/bin/bash

# Script to generate a markdown table of all deployment file names and their addresses
# for a specified network directory
# Usage: ./print-contract-addresses.sh [network_name]
# Default network: sonic_mainnet

set -e

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOYMENTS_DIR="$PROJECT_ROOT/deployments"

# Default network or use first argument
NETWORK="${1:-sonic_mainnet}"
NETWORK_DIR="$DEPLOYMENTS_DIR/$NETWORK"

# Check if network directory exists
if [ ! -d "$NETWORK_DIR" ]; then
    echo "Error: Network directory not found at $NETWORK_DIR"
    exit 1
fi

# Get current date in YYYYMMDD format
CURRENT_DATE=$(date +%Y%m%d)

# Output file name
OUTPUT_FILE="$PROJECT_ROOT/contract-addresses_${NETWORK}_${CURRENT_DATE}.md"

# Function to extract address from JSON file
extract_address() {
    local file="$1"
    if [ -f "$file" ]; then
        # Use jq if available, otherwise use grep/sed
        if command -v jq >/dev/null 2>&1; then
            jq -r '.address' "$file" 2>/dev/null || echo ""
        else
            # Fallback to grep/sed if jq is not available
            grep -m 1 '"address"' "$file" | sed 's/.*"address"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo ""
        fi
    fi
}

# Start generating the markdown file
echo "| Name | Address |" >> "$OUTPUT_FILE"
echo "|------|---------|" >> "$OUTPUT_FILE"

# Process all JSON files in the network directory (excluding hidden files and directories)
find "$NETWORK_DIR" -maxdepth 1 -name "*.json" -type f ! -name ".*" | sort | while read -r file; do
    # Get the filename without path and extension
    filename=$(basename "$file" .json)
    
    # Extract address from the JSON file
    address=$(extract_address "$file")
    
    # Only add to table if address was found and is not empty
    if [ -n "$address" ] && [ "$address" != "null" ] && [ "$address" != "" ]; then
        echo "| $filename | \`$address\` |" >> "$OUTPUT_FILE"
    fi
done

echo "Markdown table generated successfully: $OUTPUT_FILE"
