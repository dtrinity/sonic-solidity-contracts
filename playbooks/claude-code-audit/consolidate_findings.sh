#!/usr/bin/env bash
# consolidate_findings.sh – merge all module findings into one file sorted by severity
# Usage: ./consolidate_findings.sh [AUDIT_WORKSPACE_DIR]
# Default: ./audit-workspace

set -euo pipefail
WORKDIR="${1:-audit-workspace}"
OUTFILE="$WORKDIR/consolidated-findings.md"

# Header
printf "# Consolidated Findings\n\n" > "$OUTFILE"

# Concatenate all findings
for f in "$WORKDIR"/*-findings.md; do
  [ -f "$f" ] || continue
  cat "$f" >> "$OUTFILE"
  printf "\n" >> "$OUTFILE"
done

echo "Consolidated findings written to $OUTFILE" 