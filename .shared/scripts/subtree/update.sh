#!/usr/bin/env bash

# Update the shared-hardhat-tools subtree with predictable, opt-in side effects.

set -euo pipefail

REPO_URL="https://github.com/dtrinity/shared-hardhat-tools.git"
PREFIX=".shared"
BRANCH="main"
ALLOW_DIRTY=0
AUTO_STASH=0

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
  cat <<'USAGE'
Usage: update.sh [options]

Update the shared-hardhat-tools subtree. By default the script requires a clean
worktree and performs only the git subtree pull, leaving dependency installs
and setup steps to the caller.

Options:
  --prefix <path>       Location of the subtree (default: .shared)
  --branch <ref>        Remote branch or tag to pull (default: main)
  --repo-url <url>      Override the source repository URL
  --allow-dirty         Skip the clean-worktree check (use with care)
  --stash               Automatically stash and restore local changes
  -h, --help            Show this help message

Stashing or bypassing safety checks is opt-in to prevent accidental data loss.
USAGE
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

ensure_subtree_exists() {
  local repo_root="$1"
  if [[ ! -d "$repo_root/$PREFIX" ]]; then
    log "${RED}Error:${NC} Directory '$PREFIX' does not exist in this repository. Run add.sh first."
    exit 1
  fi
}

stash_changes_if_needed() {
  if [[ -z $(git status --porcelain) ]]; then
    return
  fi

  if [[ "$AUTO_STASH" -eq 1 ]]; then
    log "${YELLOW}Warning:${NC} Stashing local changes before subtree update."
    git stash push -u -m "shared-hardhat-tools subtree update" >/dev/null
    STASHED=1
    return
  fi

  if [[ "$ALLOW_DIRTY" -eq 1 ]]; then
    log "${YELLOW}Warning:${NC} Proceeding with dirty worktree (requested via --allow-dirty)."
    return
  fi

  log "${RED}Error:${NC} Working tree has uncommitted changes. Commit, stash manually, or re-run with --stash/--allow-dirty."
  exit 1
}

restore_stash_if_needed() {
  if [[ "${STASHED:-0}" -eq 1 ]]; then
    log "${BLUE}Restoring stashed changes...${NC}"
    if ! git stash pop >/dev/null; then
      log "${YELLOW}Warning:${NC} Failed to apply stashed changes automatically. Use 'git stash list' to recover them manually."
    fi
  fi
}

run_git_subtree_pull() {
  git subtree pull --prefix="$PREFIX" "$REPO_URL" "$BRANCH" --squash
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
      --allow-dirty)
        ALLOW_DIRTY=1
        shift
        ;;
      --stash)
        AUTO_STASH=1
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

  local repo_root
  repo_root=$(git rev-parse --show-toplevel)
  cd "$repo_root"

  ensure_subtree_exists "$repo_root"
  stash_changes_if_needed
  trap restore_stash_if_needed EXIT

  log "${BLUE}Pulling updates for ${PREFIX} from ${REPO_URL} (${BRANCH})...${NC}"
  run_git_subtree_pull

  log "${GREEN}Subtree updated successfully.${NC}"
  log ""
  log "Next steps:"
  log "  - Review changes in '$PREFIX' and update your project as needed."
  log "  - Run 'npm install' if package.json was modified."
  log "  - Execute 'node_modules/.bin/ts-node ${PREFIX}/scripts/setup.ts' to re-sync shared defaults if required."
  log ""
  log "Use --stash to temporarily save local changes or --allow-dirty to bypass the safety check."
}

main "$@"
