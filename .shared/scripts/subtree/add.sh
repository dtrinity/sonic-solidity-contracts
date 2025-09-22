#!/bin/bash

# Script to add shared-hardhat-tools as a git subtree to a project

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/dtrinity/shared-hardhat-tools.git"
DEFAULT_PREFIX=".shared"
DEFAULT_BRANCH="main"

# Parse arguments
PREFIX="${1:-$DEFAULT_PREFIX}"
BRANCH="${2:-$DEFAULT_BRANCH}"

echo -e "${BLUE}Adding shared-hardhat-tools as a git subtree...${NC}"

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo -e "${RED}Error: Not in a git repository${NC}"
  exit 1
fi

# Check if the directory already exists
if [ -d "$PREFIX" ]; then
  echo -e "${YELLOW}Warning: Directory '$PREFIX' already exists${NC}"
  read -p "Do you want to remove it and add the subtree? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$PREFIX"
    git add -A
    git commit -m "Remove existing $PREFIX directory for subtree integration" || true
  else
    echo -e "${RED}Aborted: Directory already exists${NC}"
    exit 1
  fi
fi

# Add the subtree
echo -e "${BLUE}Adding subtree from $REPO_URL...${NC}"
git subtree add --prefix="$PREFIX" "$REPO_URL" "$BRANCH" --squash

if [ $? -eq 0 ]; then
  echo -e "${GREEN}Successfully added shared-hardhat-tools as subtree at '$PREFIX'${NC}"

  # Update package.json to include the shared tools
  if [ -f "package.json" ]; then
    echo -e "${BLUE}Updating package.json...${NC}"

    # Check if jq is available for JSON manipulation
    if command -v jq > /dev/null 2>&1; then
      # Add dependency using jq
      jq ".dependencies[\"@dtrinity/shared-hardhat-tools\"] = \"file:$PREFIX\"" package.json > package.json.tmp
      mv package.json.tmp package.json
      echo -e "${GREEN}Added @dtrinity/shared-hardhat-tools to dependencies${NC}"
    else
      echo -e "${YELLOW}Please manually add the following to your package.json dependencies:${NC}"
      echo -e "  \"@dtrinity/shared-hardhat-tools\": \"file:$PREFIX\""
    fi

    echo -e "${BLUE}Installing dependencies...${NC}"
    npm install
  fi

  # Set up git hooks
  echo -e "${BLUE}Setting up git hooks...${NC}"
  if [ -f "$PREFIX/scripts/setup.ts" ]; then
    TS_NODE_BIN="node_modules/.bin/ts-node"
    if [ -x "$TS_NODE_BIN" ]; then
      "$TS_NODE_BIN" "$PREFIX/scripts/setup.ts" --hooks
    elif command -v ts-node >/dev/null 2>&1; then
      ts-node "$PREFIX/scripts/setup.ts" --hooks
    else
      echo -e "${YELLOW}ts-node is not available in PATH; skipping automatic hook setup.${NC}"
      echo -e "${YELLOW}You can run '$PREFIX/scripts/setup.ts --hooks' manually once ts-node is installed.${NC}"
    fi
  else
    # Manual hook setup
    if [ -f "$PREFIX/hooks/pre-commit" ]; then
      cp "$PREFIX/hooks/pre-commit" .git/hooks/pre-commit
      chmod +x .git/hooks/pre-commit
      echo -e "${GREEN}Installed pre-commit hook${NC}"
    fi
    if [ -f "$PREFIX/hooks/pre-push" ]; then
      cp "$PREFIX/hooks/pre-push" .git/hooks/pre-push
      chmod +x .git/hooks/pre-push
      echo -e "${GREEN}Installed pre-push hook${NC}"
    fi
  fi

  echo
  echo -e "${GREEN}Setup complete!${NC}"
  echo
  echo "Available commands:"
  echo "  npm run --prefix $PREFIX slither       # Run Slither analysis"
  echo "  npm run --prefix $PREFIX mythril       # Run Mythril analysis"
  echo "  npm run --prefix $PREFIX solhint       # Run Solhint linter"
  echo "  npm run --prefix $PREFIX analyze:all   # Run all analyses"
  echo
  echo "To update the subtree later:"
  echo "  $PREFIX/scripts/subtree/update.sh"

else
  echo -e "${RED}Failed to add subtree${NC}"
  exit 1
fi
