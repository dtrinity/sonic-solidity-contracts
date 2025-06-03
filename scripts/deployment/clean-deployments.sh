#!/bin/sh

# Usage: clean-deployments.sh <deployment_keywords> <network>

if [ -z "$1" ]; then
  echo "Must provide 'deployment_keywords' as the first argument"
  exit 1
fi

if [ -z "$2" ]; then
  echo "Must provide 'network' as the second argument"
  exit 1
fi

deployment_keywords="$1"
network="$2"

migrations_file="deployments/$network/.migrations.json"

echo "Removing deployments with keyword '$deployment_keywords' from $migrations_file..."

if [ ! -f "$migrations_file" ]; then
  echo "File $migrations_file does not exist!"
  exit 1
fi

# If jq is not installed, install it
if ! command -v jq &> /dev/null; then
  echo "'jq' could not be found, please install it"
  exit 1
fi

# Split keywords by comma
IFS=',' read -ra KEYWORDS <<< "$deployment_keywords"

# Build jq filter to delete all keys containing any keyword
jq_filter=''
for key in $(jq -r 'keys[]' "$migrations_file"); do
  for keyword in "${KEYWORDS[@]}"; do
    if echo "$key" | grep -q "$keyword"; then
      if [ -z "$jq_filter" ]; then
        jq_filter=".[\"$key\"]"
      else
        jq_filter="$jq_filter, .[\"$key\"]"
      fi
    fi
  done
done

if [ -z "$jq_filter" ]; then
  echo "No matching keys found for keywords: $deployment_keywords. No changes made."
  exit 0
fi

echo "Cleaning deployments with keyword '$deployment_keywords' from $migrations_file..."
jq_command="del($jq_filter)"
jq "$jq_command" "$migrations_file" > temp.json && mv temp.json "$migrations_file"

if [ $? -eq 0 ]; then
  echo "Successfully cleaned deployments with keyword '$deployment_keywords' from $migrations_file."
else
  echo "Failed to clean deployments."
  exit 1
fi

# Remove the corresponding deployment files if they exist
# The keywords are not the exact deployment names, we need to do substring matching
echo "Removing corresponding deployment files..."
for keyword in "${KEYWORDS[@]}"; do
  for file in "deployments/$network"/*; do
    if [ -f "$file" ] && [ "$(basename "$file")" != ".migrations.json" ]; then
      if [[ "$(basename "$file")" == *"$keyword"* ]]; then
        echo " - Found and removing $file"
        rm -f "$file"
      fi
    fi
  done
done

echo "Successfully removed corresponding deployment files."
