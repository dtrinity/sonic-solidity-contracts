#!/bin/bash

# Script to export GitHub issues in Google Sheets compatible format
# Usage: ./list-github-issues.sh

REPO="hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe"

echo "Fetching issues from repository: $REPO"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed. Please install it first."
    echo "Visit: https://cli.github.com/"
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo "Error: Not authenticated with GitHub CLI. Please run 'gh auth login' first."
    exit 1
fi

# Create temporary file for CSV data
temp_file=$(mktemp)

# Add tab-separated header (better for Google Sheets)
echo -e "Issue Number\tTitle\tState\tAuthor\tCreated At\tUpdated At\tLabels\tURL" > "$temp_file"

# Fetch all issues (both open and closed) and format as TSV (tab-separated values)
# Using --limit 1000 to get a large number of issues (adjust if needed)
gh issue list \
    --repo "$REPO" \
    --state all \
    --limit 1000 \
    --json number,title,state,author,createdAt,updatedAt,labels,url > /tmp/issues.json

# Process the JSON and convert to TSV format
jq -r '.[] | [
    (.number // (.url | split("/")[-1] | tonumber)),
    (.title | gsub("\\t"; " ") | gsub("\\n"; " ") | gsub("\\r"; "") | gsub("\""; "")),
    .state,
    .author.login,
    (.createdAt | split("T")[0]),
    (.updatedAt | split("T")[0]),
    (.labels | map(.name) | join("; ")),
    .url
] | @tsv' /tmp/issues.json >> "$temp_file"

# Sort by issue number in ascending order (skip header, sort, then add header back)
sorted_file=$(mktemp)
head -n 1 "$temp_file" > "$sorted_file"
tail -n +2 "$temp_file" | sort -t$'\t' -k1,1n >> "$sorted_file"

# Copy to clipboard based on OS
if command -v pbcopy &> /dev/null; then
    # macOS
    cat "$sorted_file" | pbcopy
    echo "✅ Issues exported in Google Sheets format and copied to clipboard (macOS)"
elif command -v xclip &> /dev/null; then
    # Linux with xclip
    cat "$sorted_file" | xclip -selection clipboard
    echo "✅ Issues exported in Google Sheets format and copied to clipboard (Linux - xclip)"
elif command -v xsel &> /dev/null; then
    # Linux with xsel
    cat "$sorted_file" | xsel --clipboard --input
    echo "✅ Issues exported in Google Sheets format and copied to clipboard (Linux - xsel)"
else
    echo "⚠️  Clipboard utility not found. Content saved to: issues_export.tsv"
    cp "$sorted_file" "issues_export.tsv"
    echo "You can manually copy the content from issues_export.tsv and paste into Google Sheets"
fi

# Show preview of the data
echo ""
echo "Preview of exported data:"
echo "========================="
head -n 6 "$sorted_file"
echo ""
echo "Total issues exported: $(($(wc -l < "$sorted_file") - 1))"

# Cleanup temporary files
rm "$temp_file" "$sorted_file" /tmp/issues.json
