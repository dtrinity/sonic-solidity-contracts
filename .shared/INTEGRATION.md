# Integration Guide for AI Agents

This guide provides detailed instructions for AI agents to integrate shared-hardhat-tools into dTrinity network repositories.

## Quick Start for AI Agents

When asked to integrate shared tools into a network repository, follow these steps:

### 1. Minimal Integration (Recommended First Step)

```bash
# Add subtree at .shared directory
git subtree add --prefix=.shared https://github.com/dtrinity/shared-hardhat-tools.git main --squash

# Install as local package
npm install file:./.shared

# The shared package ships with ts-node/typescript, so this step ensures the CLI
# is available without extra dependencies in the consuming repo.

# Run the setup script with a minimal phase to verify the integration and add
# baseline npm scripts.
node_modules/.bin/ts-node .shared/scripts/setup.ts --package-scripts

# The setup script performs preflight validation (git repo, .shared subtree,
# hardhat.config.* present, readable package.json) before making changes. Add
# --hooks, --configs, or --ci when you're ready to install those assets.
```

### 2. Test Basic Functionality

> The commands below call `node_modules/.bin/ts-node` explicitly so they use the
> bundled runtime without relying on global installs. If your environment adds
> `node_modules/.bin` to `PATH`, you can drop the prefix.

```bash
# Test that the package is accessible
node_modules/.bin/ts-node -e "const tools = require('@dtrinity/shared-hardhat-tools'); console.log('Tools loaded:', Object.keys(tools));"

# Test a simple script
node_modules/.bin/ts-node .shared/scripts/analysis/solhint.ts --help 2>/dev/null || echo "Script executable"

# Optional: lint a narrow slice (requires repo ESLint deps)
node_modules/.bin/ts-node .shared/scripts/linting/eslint.ts --pattern 'typescript/**/*.ts' --quiet || true

# Optional: guardrail dry run (skip heavy checks at first)
node_modules/.bin/ts-node .shared/scripts/guardrails/check.ts --skip-prettier --skip-solhint || true

# Optional: ensure Slither is available (installs via pipx/pip if missing)
node_modules/.bin/ts-node .shared/scripts/analysis/install-slither.ts || true

# Optional: run the shared Slither default preset (mirrors Sonic's Makefile target)
node_modules/.bin/ts-node .shared/scripts/analysis/slither.ts default || true
```
Run these from the repository root so guardrail validation can find `package.json` and `hardhat.config.*`. Expect non-zero exits when formatting issues are discovered—that simply means the guards are working.


### 3. Conservative Integration Steps

Start with these minimal changes:

#### A. Add Package Scripts (package.json)
```bash
node_modules/.bin/ts-node .shared/scripts/setup.ts --package-scripts
```

The setup script adds or normalizes the shared baseline (`analyze:shared`, `lint:*`, `guardrails:check`, `shared:update`).
If any script already exists with custom behavior, the tool reports it as a manual follow-up instead of overwriting.
The lint entries assume the project already includes ESLint/Prettier (most repos do). Start with small `--pattern`
scopes or the `--skip-prettier` flag when introducing them to an older codebase.


#### B. Optional: Copy One Config
```bash
# Only if project doesn't have .solhint.json
cp .shared/configs/solhint.json .solhint.shared.json
```

### 4. Verify Integration

```bash
# Check subtree was added
ls -la .shared/

# Check package installed
npm ls @dtrinity/shared-hardhat-tools

# Test a command (non-destructive)
node_modules/.bin/ts-node .shared/scripts/analysis/solhint.ts --quiet --max-warnings 0 || true
```

## Important Context for AI Agents

### DO NOT on First Integration:
- ❌ Do not overwrite existing configurations
- ❌ Do not install git hooks initially
- ❌ Do not modify CI/CD workflows yet
- ❌ Do not run security scans that might fail the build
- ❌ Do not run repo-wide Prettier/guardrail suites on the first pass (start with targeted patterns or skip flags)

### DO on First Integration:
- ✅ Add subtree at .shared
- ✅ Install as npm dependency
- ✅ Run `node_modules/.bin/ts-node .shared/scripts/setup.ts --package-scripts`
- ✅ Test that imports work
- ✅ Dry-run shared linting/guardrail scripts with conservative options (patterns, --skip-prettier, --skip-solhint)
- ✅ Commit changes with clear message

### Testing Commands (Safe)

These commands are safe to run and won't modify files:

```bash
# List available scripts
ls .shared/scripts/analysis/

# Check TypeScript compilation
npx tsc --noEmit --project .shared/tsconfig.json

# Test imports
node_modules/.bin/ts-node -e "
const { logger, configLoader } = require('@dtrinity/shared-hardhat-tools');
logger.info('Shared tools integrated successfully');
"

# Try ESLint on a narrow slice
node_modules/.bin/ts-node .shared/scripts/linting/eslint.ts --pattern 'typescript/**/*.ts' --quiet || true

# Guardrail dry run (skips heavy checks)
node_modules/.bin/ts-node .shared/scripts/guardrails/check.ts --skip-prettier --skip-solhint || true
```

### Network-Specific Considerations

Each network may have different:
- Solidity versions (check pragma in contracts)
- Dependencies (check package.json)
- CI/CD setups (check .github/workflows)
- Existing tools (check for .solhint.json, slither.config.json)

### Rollback if Needed

```bash
# Remove subtree (if integration fails)
git rm -rf .shared
git commit -m "Remove shared tools for debugging"

# Remove from package.json
npm uninstall @dtrinity/shared-hardhat-tools
```

## Full Integration Checklist (For Later)

Once minimal integration is verified, consider:

- [ ] Set up git hooks: `node_modules/.bin/ts-node .shared/scripts/setup.ts --hooks`
  - Pre-commit executes guardrails and staged-file heuristics; enable Prettier with `SHARED_HARDHAT_PRE_COMMIT_PRETTIER=1` and contract compilation with `SHARED_HARDHAT_PRE_COMMIT_COMPILE=1` when you want them enforced locally.
  - Pre-push reruns guardrails, optionally runs tests (`SHARED_HARDHAT_PRE_PUSH_TEST=1`) or a custom command (`SHARED_HARDHAT_PRE_PUSH_TEST_CMD="yarn test --runInBand"`), enables Prettier with `SHARED_HARDHAT_PRE_PUSH_PRETTIER=1`, and requires Slither only on `main`/`master`/`develop`.
- [ ] Add shared CI workflow: `cp .shared/ci/shared-guardrails.yml .github/workflows/`
- [ ] Configure network-specific overrides
- [ ] Run full security analysis: `npm run analyze:shared`
- [ ] Document in project README

## Troubleshooting for AI Agents

### Error: `Guardrail checks aborted: project validation failed.`
**Cause**: Guardrails were executed from inside `.shared/` or the repository lacks a `hardhat.config.*` file in its root.
**Solution**: Run the command from the project root and confirm the Hardhat config lives alongside `package.json`.

### Error: `Tooling error: Required tool 'prettier' is not installed`
**Cause**: The consuming repo does not have the expected linting dependency installed.
**Solution**: Install missing devDependencies (e.g., `npm install -D prettier prettier-plugin-solidity`), then re-run.

### Error: "Cannot find module '@dtrinity/shared-hardhat-tools'"
**Solution**: Run `npm install file:./.shared`

### Error: "fatal: prefix '.shared' already exists"
**Solution**: Directory exists, either remove it or use different prefix

### Error: "ts-node: command not found"
**Solution**: Re-run `npm install` so the shared subtree's dependencies (which include ts-node and typescript) are installed. If you're testing ad-hoc without updating package.json, prefix commands with `node_modules/.bin/ts-node` from the shared directory so the bundled CLI is used.

### Error: Compilation errors in shared tools
**Solution**: Check TypeScript version compatibility: `npx tsc --version`

## Success Criteria

Integration is successful when:
1. `.shared` directory exists and contains the tools
2. `npm ls @dtrinity/shared-hardhat-tools` shows the package
3. At least one shared command works
4. Changes are committed without breaking existing functionality

## Agent Instructions Summary

```plaintext
WHEN ASKED: "Integrate shared tools into [network] repository"
THEN DO:
1. Create feature branch
2. Add subtree at .shared
3. Install as npm package
4. Add 1-2 package.json scripts
5. Test basic functionality
6. Commit with descriptive message
7. Report success/issues to user
```
