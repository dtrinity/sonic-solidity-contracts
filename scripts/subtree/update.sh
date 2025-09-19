#!/bin/bash

# Script to update the shared-hardhat-tools subtree

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

echo -e "${BLUE}Updating shared-hardhat-tools subtree...${NC}"

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo -e "${RED}Error: Not in a git repository${NC}"
  exit 1
fi

# Check if the subtree directory exists
if [ ! -d "$PREFIX" ]; then
  echo -e "${RED}Error: Subtree directory '$PREFIX' does not exist${NC}"
  echo "Run the add script first: $PREFIX/scripts/subtree/add.sh"
  exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo -e "${YELLOW}Warning: You have uncommitted changes${NC}"
  read -p "Do you want to stash them and continue? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git stash push -m "Before shared-hardhat-tools subtree update"
    STASHED=true
  else
    echo -e "${RED}Aborted: Please commit or stash your changes first${NC}"
    exit 1
  fi
fi

# Pull the latest changes
echo -e "${BLUE}Pulling latest changes from $REPO_URL...${NC}"
git subtree pull --prefix="$PREFIX" "$REPO_URL" "$BRANCH" --squash

if [ $? -eq 0 ]; then
  echo -e "${GREEN}Successfully updated shared-hardhat-tools${NC}"

  # Reinstall dependencies in case package.json changed
  if [ -f "$PREFIX/package.json" ]; then
    echo -e "${BLUE}Reinstalling shared tool dependencies...${NC}"
    npm install
  fi

  # Update git hooks
  echo -e "${BLUE}Updating git hooks...${NC}"
  if [ -f "$PREFIX/hooks/pre-commit" ]; then
    cp "$PREFIX/hooks/pre-commit" .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo -e "${GREEN}Updated pre-commit hook${NC}"
  fi
  if [ -f "$PREFIX/hooks/pre-push" ]; then
    cp "$PREFIX/hooks/pre-push" .git/hooks/pre-push
    chmod +x .git/hooks/pre-push
    echo -e "${GREEN}Updated pre-push hook${NC}"
  fi

  # Show what changed
  echo
  echo -e "${BLUE}Changes in this update:${NC}"
  git log -1 --oneline

  # Restore stashed changes if any
  if [ "${STASHED:-false}" = true ]; then
    echo -e "${BLUE}Restoring stashed changes...${NC}"
    git stash pop
  fi

  echo
  echo -e "${GREEN}Update complete!${NC}"

else
  echo -e "${RED}Failed to update subtree${NC}"

  # Restore stashed changes if any
  if [ "${STASHED:-false}" = true ]; then
    echo -e "${BLUE}Restoring stashed changes...${NC}"
    git stash pop
  fi

  exit 1
fi