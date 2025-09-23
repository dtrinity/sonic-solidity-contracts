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

#### Hook up the shared Makefile

Add the following to the repository `Makefile` (create one if it does not exist):

```make
# shared targets live here; define project-specific targets after this line
include .shared/Makefile
```

The include injects the common `make lint`, `make lint.ci`, `make slither`, and guardrail helper targets so teams keep familiar workflows while relying on the shared TypeScript tooling.

> Prefer automation over manual flags? When you have access to this repository
> locally, `bash path/to/scripts/subtree/add.sh --help` prints the non-
> interactive wrapper that enforces a clean worktree and requires
> `--force-remove` before replacing an existing `.shared` directory.

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

# Optional: confirm deploy scripts reference shared IDs (provide custom paths if needed)
node_modules/.bin/ts-node .shared/scripts/deployments/find-hardcoded-deploy-ids.ts --quiet || true

# Optional: dry-run deployment cleanup (keywords match migrations entries + filenames)
node_modules/.bin/ts-node .shared/scripts/deployments/clean-deployments.ts --network mainnet --keywords Vault --dry-run || true

# Optional: summarize deployment addresses or oracle sources
node_modules/.bin/ts-node .shared/scripts/deployments/print-contract-addresses.ts --network mainnet || true
node_modules/.bin/ts-node .shared/scripts/deployments/print-oracle-sources.ts --network mainnet --json || true

# Optional: generate an nSLOC report (writes to reports/nsloc.md by default)
node_modules/.bin/ts-node .shared/scripts/deployments/nsloc.ts || true
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

## End-to-End Subtree Lifecycle

### First Integration Runbook

1. **Start clean** – abort if `git status --short` is non-empty. Fix compilation locally so guardrails have a stable baseline.
2. **Add the subtree** – prefer the wrapper: `bash scripts/subtree/add.sh --repo-url https://github.com/dtrinity/shared-hardhat-tools.git --branch main --prefix .shared`. Pass `--force-remove` only when replacing an existing directory after backing it up.
3. **Install the package** – `npm install file:./.shared` (or the equivalent `yarn/pnpm` command) so the bundled `ts-node` runtime is available.
4. **Run the setup preflight** – execute `node_modules/.bin/ts-node .shared/scripts/setup.ts --package-scripts` to add baseline npm scripts and surface missing prerequisites. Expand to `--hooks`, `--configs`, or `--ci` in follow-up passes when stakeholders sign off.
5. **Take a smoke-test lap** – run `npm run --prefix .shared lint:eslint -- --pattern 'hardhat.config.ts'`, `npm run --prefix .shared sanity:deploy-ids -- --quiet`, and `npm run --prefix .shared guardrails:check -- --skip-prettier --skip-solhint` to confirm the shared tooling works in situ before committing.

### Updating the Subtree

1. **Fetch the latest source** – from within the network repo, run `bash .shared/scripts/subtree/update.sh --repo-url ../shared-hardhat-tools --branch main`. Add `--stash` if local changes need to be preserved.
2. **Reinstall if needed** – if `.shared/package.json` or lockfiles changed, rerun your package manager so the new dependencies land.
3. **Re-apply setup phases** – execute `node_modules/.bin/ts-node .shared/scripts/setup.ts --package-scripts --hooks --configs --ci` (use only the phases you rely on) to pick up new defaults without clobbering overrides.
4. **Validate guardrails** – `npm run --prefix .shared test` plus a targeted guardrail command (`npm run --prefix .shared guardrails:check -- --fail-fast`) ensures the update behaves before opening a PR.
5. **Commit with intent** – stage the `.shared` diff (and any lockfile changes), write a commit message that points to the shared repo tag or commit, and describe any manual steps consumers must perform.

### Post-Update Validation

After large updates, capture a quick status report in the PR description:
- Which commands were executed (lint, sanity checks, tests)
- Whether `reports/` artifacts were reviewed
- Any environment variables that had to be toggled
- Follow-ups uncovered for downstream documentation or tooling

## Important Context for AI Agents

### Updating the Subtree Safely

```bash
# Default: requires a clean worktree
bash .shared/scripts/subtree/update.sh

# Common helpers
bash .shared/scripts/subtree/update.sh --stash       # auto-stash + restore
bash .shared/scripts/subtree/update.sh --allow-dirty # bypass the safety check entirely
```

> The helper intentionally skips package installs and hook syncing. After a
> pull, review the diff, run your package manager if `package.json` changed,
> and re-run the setup script for any phases that should pick up new assets.

### CI Wiring Checklist

1. **Ensure scripts exist** – confirm `package.json` exposes `guardrails:check`, `sanity:deploy-ids`, and the shared `lint:*` entries (or capture repo-specific equivalents). The setup script reports anything missing.
2. **Install the shared package in CI** – add `npm install file:./.shared` (or `yarn add file:./.shared`) before calling the guardrail workflow so `ts-node` is on the PATH.
3. **Reference the shared workflow** – commit `.github/workflows/security.yml` that points to `uses: ./.shared/ci/shared-guardrails.yml`. The setup script’s `--ci` flag can place the workflow stub for you.
4. **Keep reports tidy** – ensure `reports/` is ignored locally; CI will upload artifacts automatically. Download them when diagnosing failing runs.
5. **Stack extra jobs** – add repo-specific jobs (deployments, simulations) after the shared guardrails job, or run the shared workflow from a parent pipeline for consistency across repos.

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

## Release Cadence & Propagation

1. **Batch changes weekly** – keep `shared-hardhat-tools` improvements on feature branches, then merge into `main` once smoke tests pass locally (`npm test`).
2. **Dogfood in Sonic** – refresh the `.shared` subtree inside `sonic-solidity-contracts@test-shared-tools-integration`, install dependencies, and run `npm test`, `npm run --prefix .shared guardrails:check -- --fail-fast`, and at least one Slither preset. Note any manual tweaks required.
3. **Tag the release** – when Sonic is clean, tag the shared repo (`git tag v1.X.Y && git push origin v1.X.Y`) and jot down a short summary (changed scripts, new docs, required env vars).
4. **Cascade across networks** – open PRs (or provide commands) for every Hardhat repo: `bash .shared/scripts/subtree/update.sh --repo-url https://github.com/dtrinity/shared-hardhat-tools.git --branch main`, rerun `setup.ts`, and attach the release notes.
5. **Record the outcome** – update `WIP.md` with the tag, dogfooding notes, and any follow-ups discovered so the next cycle starts with context.

### Multi-Repo Validation Flow

- Before announcing a release, run `npm run validate:matrix` so lint, compile, and test commands pass on every Hardhat repo.
- The CLI accepts repeated `--repo name=/path/to/repo` flags or a config file (`configs/validation.sample.json`) with shared defaults and per-repo overrides.
- Add `--task` to change the global task list, `--command lint="yarn lint"` to override specific commands, and `--install` (or repo-level `install: true`) to reinstall dependencies first.
- Provide `--report reports/validation.json` to emit a machine-readable summary with durations, exit codes, and skip reasons for release notes.
- Fallback commands run via `npx`, so lint/compile can succeed even when a repo hasn’t re-installed its workspace dependencies yet.
- The script still auto-detects npm/yarn/pnpm and stops after the first failure for a repo so you can triage issues before syncing other networks.
- `configs/validation.networks.json` lists the current Hardhat repos (lint + compile with installs) so agents can kick off the full fleet sweep with one flag.

```bash
# Validate Sonic only
npm run validate:matrix -- --repo sonic=../sonic-solidity-contracts

# Drive the run from a config file and record a summary
npm run validate:matrix -- --config configs/validation.sample.json --install --report reports/validation.json
npm run validate:matrix -- --config configs/validation.networks.json --report reports/validation.json
```

## Full Integration Checklist (For Later)

Once minimal integration is verified, consider:

- [ ] Set up git hooks: `node_modules/.bin/ts-node .shared/scripts/setup.ts --hooks`
  - Pre-commit executes guardrails and staged-file heuristics; enable Prettier with `SHARED_HARDHAT_PRE_COMMIT_PRETTIER=1` and contract compilation with `SHARED_HARDHAT_PRE_COMMIT_COMPILE=1` when you want them enforced locally.
  - Pre-push reruns guardrails, optionally runs tests (`SHARED_HARDHAT_PRE_PUSH_TEST=1`) or a custom command (`SHARED_HARDHAT_PRE_PUSH_TEST_CMD="yarn test --runInBand"`), enables Prettier with `SHARED_HARDHAT_PRE_PUSH_PRETTIER=1`, and requires Slither only on `main`/`master`/`develop`.
- [ ] Add shared CI workflow: `cp .shared/ci/shared-guardrails.yml .github/workflows/` (runs lint + sanity checks, Hardhat compile, and tests with a summary step)
- [ ] Configure the deploy ID sanity check (`sanity:deploy-ids` npm script or direct call with repo-specific `--deploy-ids/--deploy-root` arguments)
- [ ] Use the deployment helpers when needed:
  - `sanity:deploy-clean` for pruning migrations + artifact files
  - `sanity:deploy-addresses` to produce contract/address reports
  - `sanity:oracle-addresses` to capture oracle inventories (customise with `--category`/`--exclude`)
  - `metrics:nsloc` for lightweight Solidity metrics snapshots
- [ ] Configure network-specific overrides
- [ ] Run full security analysis: `npm run analyze:shared`
- [ ] Document in project README

> Tip: repos that store deploy IDs outside the default `typescript/deploy-ids.ts`
> path should add a `sanity:deploy-ids` npm script that forwards the correct
> `--deploy-ids`/`--deploy-root` options so CI can execute the check without
> additional configuration.

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

### Error: `ENOENT ... node_modules/...` during `yarn install`
**Cause**: The repository still has `node_modules` artifacts produced by `npm install`, which Yarn 4 cannot reconcile.
**Solution**: Remove the existing `node_modules` directory and re-run `yarn install` so Yarn recreates the workspace from scratch.

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
