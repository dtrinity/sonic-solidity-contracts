#!/usr/bin/env bash

# Add shared-hardhat-tools as a git subtree without mutating the host repo by default.

set -euo pipefail

REPO_URL="https://github.com/dtrinity/shared-hardhat-tools.git"
PREFIX=".shared"
BRANCH="main"
ALLOW_DIRTY=0
FORCE_REMOVE=0
PYTHON_BIN="$(command -v python3 || command -v python || true)"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
  cat <<'EOF'
Usage: add.sh [options]

Add the shared-hardhat-tools repository as a git subtree. The script performs
only the git operations by default and prints follow-up steps for installing
dependencies or running setup.

Options:
  --prefix <path>       Target directory for the subtree (default: .shared)
  --branch <ref>        Remote branch or tag to pull (default: main)
  --repo-url <url>      Override the source repository URL
  --force-remove        Remove an existing directory at --prefix before adding
  --allow-dirty         Skip the clean-worktree check
  -h, --help            Show this help message

Destructive actions (removal of existing directories) require explicit flags.
EOF
}

log() {
  printf '%b\n' "$1"
}

ensure_git_repo() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "${RED}Error:${NC} This command must be run inside a git repository."
    exit 1
  fi
}

require_clean_worktree() {
  if [[ "$ALLOW_DIRTY" -eq 1 ]]; then
    return
  fi

  if [[ -n $(git status --porcelain) ]]; then
    log "${RED}Error:${NC} Working tree has uncommitted changes. Commit, stash, or re-run with --allow-dirty."
    exit 1
  fi
}

resolve_path_within_repo() {
  if [[ -z "$PYTHON_BIN" ]]; then
    log "${RED}Error:${NC} Python is required to validate paths safely. Install python3 or run from an environment where it is available."
    exit 1
  fi
  local repo_root="$1"
  local input_path="$2"
  "$PYTHON_BIN" - "$repo_root" "$input_path" <<'PY'
import os
import sys

repo_root = os.path.realpath(sys.argv[1])
path = os.path.realpath(os.path.join(repo_root, sys.argv[2]))

if not path.startswith(repo_root + os.sep) and path != repo_root:
    raise SystemExit(f"error: path '{sys.argv[2]}' escapes repository root")

print(path)
PY
}

remove_existing_prefix() {
  local repo_root="$1"
  local target_path
  target_path=$(resolve_path_within_repo "$repo_root" "$PREFIX")

  if [[ ! -d "$target_path" ]]; then
    return
  fi

  if [[ "$FORCE_REMOVE" -ne 1 ]]; then
    log "${RED}Error:${NC} Directory '$PREFIX' already exists. Remove it manually or pass --force-remove."
    exit 1
  fi

  log "${YELLOW}Warning:${NC} Removing existing directory '$PREFIX'."
  rm -rf "$target_path"
}

run_git_subtree_add() {
  git subtree add --prefix="$PREFIX" "$REPO_URL" "$BRANCH" --squash
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prefix)
        PREFIX="$2"
        shift 2
        ;;
      --branch)
        BRANCH="$2"
        shift 2
        ;;
      --repo-url)
        REPO_URL="$2"
        shift 2
        ;;
      --force-remove)
        FORCE_REMOVE=1
        shift
        ;;
      --allow-dirty)
        ALLOW_DIRTY=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        log "${RED}Error:${NC} Unknown argument '$1'."
        usage
        exit 1
        ;;
    esac
  done

  ensure_git_repo
  require_clean_worktree

  local repo_root
  repo_root=$(git rev-parse --show-toplevel)
  cd "$repo_root"

  remove_existing_prefix "$repo_root"

  log "${BLUE}Adding shared-hardhat-tools subtree from ${REPO_URL} (${BRANCH})...${NC}"
  run_git_subtree_add

  log "${GREEN}Subtree added at '${PREFIX}'.${NC}"
  log ""
  log "Next steps:"
  log "  - Add '@dtrinity/shared-hardhat-tools': 'file:${PREFIX}' to package.json dependencies."
  log "  - Run 'npm install' (or your package manager) to link the subtree."
  log "  - Execute 'node_modules/.bin/ts-node ${PREFIX}/scripts/setup.ts' to install shared defaults."
  log ""
  log "Pass --allow-dirty to bypass the clean check or --force-remove to replace an existing directory."
}

main "$@"
