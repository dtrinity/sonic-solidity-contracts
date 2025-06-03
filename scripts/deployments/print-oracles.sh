#!/bin/bash

# Script to extract oracle addresses from deployment files
# Searches for files containing "Redstone", "API3", and "Chainlink" in their names
# and extracts the address field from each deployment JSON
# Excludes files with "Mock" in their names

# Purpose: This script is used by the frontend for displaying oracle source in the UI. This script must be run manually and then the output can be copied into the frontend config.

set -e

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOYMENTS_DIR="$PROJECT_ROOT/deployments"

# Check if deployments directory exists
if [ ! -d "$DEPLOYMENTS_DIR" ]; then
    echo "Error: Deployments directory not found at $DEPLOYMENTS_DIR"
    exit 1
fi

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

# Function to collect addresses for a specific oracle type
collect_addresses() {
    local network_dir="$1"
    local pattern="$2"
    local addresses=()
    
    while IFS= read -r -d '' file; do
        # Skip files with "Mock" in their name
        if [[ "$(basename "$file")" == *"Mock"* ]]; then
            continue
        fi
        
        address=$(extract_address "$file")
        if [ -n "$address" ] && [ "$address" != "null" ]; then
            addresses+=("'$address'")
        fi
    done < <(find "$network_dir" -maxdepth 1 -name "*${pattern}*.json" -print0 2>/dev/null)
    
    echo "${addresses[@]}"
}

# Function to format address array
format_addresses() {
    local addresses=($@)
    if [ ${#addresses[@]} -eq 0 ]; then
        echo "[]"
    else
        echo "["
        for i in "${!addresses[@]}"; do
            if [ $i -eq $((${#addresses[@]} - 1)) ]; then
                echo "      ${addresses[$i]}"
            else
                echo "      ${addresses[$i]},"
            fi
        done
        echo -n "    ]"
    fi
}

# Main execution
echo "{"

# Get network directories
networks=($(find "$DEPLOYMENTS_DIR" -maxdepth 1 -type d -name "*" ! -path "$DEPLOYMENTS_DIR" | sort))

for i in "${!networks[@]}"; do
    network_dir="${networks[$i]}"
    network_name="$(basename "$network_dir")"
    
    # Skip hidden directories
    if [[ "$network_name" =~ ^\. ]]; then
        continue
    fi
    
    echo "  $network_name: {"
    
    # Collect addresses for each oracle type
    redstone_addresses=($(collect_addresses "$network_dir" "Redstone"))
    api3_addresses=($(collect_addresses "$network_dir" "API3"))
    chainlink_addresses=($(collect_addresses "$network_dir" "Chainlink"))
    
    # Format and output
    echo -n "    Redstone: "
    format_addresses "${redstone_addresses[@]}"
    echo ","
    
    echo -n "    API3: "
    format_addresses "${api3_addresses[@]}"
    echo ","
    
    echo -n "    Chainlink: "
    format_addresses "${chainlink_addresses[@]}"
    echo ""
    
    echo -n "  }"
    
    # Add comma if not the last network
    if [ $i -lt $((${#networks[@]} - 1)) ]; then
        echo ","
    else
        echo ""
    fi
done

echo "}"