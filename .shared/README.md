# Shared Hardhat Tools

Centralized development tools and security guardrails for dTrinity Hardhat projects. This package provides shared configurations, scripts, and workflows that can be integrated into network-specific repositories using git subtree.

## Features

- 🔍 **Static Analysis**: Integrated Slither, Mythril, and Solhint configurations
- 🎨 **Code Quality**: Shared linting and formatting configurations
- 🔒 **Security Guardrails**: Pre-commit and pre-push hooks
- 🚀 **CI/CD Templates**: GitHub Actions workflows for automated checks
- 📦 **TypeScript Support**: Full TypeScript implementation with ts-node
- 🧩 **Deployment Helpers**: Shared checks for deploy IDs, address reports, oracle inventories, and nSLOC metrics
- 🔄 **Easy Updates**: Simple subtree update mechanism

## Installation

### Using Git Subtree (Recommended)

Add this repository as a subtree in your Hardhat project:

```bash
# Add as subtree at .shared directory
git subtree add --prefix=.shared https://github.com/dtrinity/shared-hardhat-tools.git main --squash

# Install as local npm package
npm install file:./.shared

# Run setup script (runs preflight checks and installs shared defaults)
node_modules/.bin/ts-node .shared/scripts/setup.ts

# Limit to specific phases if needed (e.g., only package scripts + configs)
node_modules/.bin/ts-node .shared/scripts/setup.ts --package-scripts --configs

> `ts-node` and `typescript` are bundled with the shared package, so installing
> from the subtree automatically provides the runtime needed to execute the
> TypeScript entrypoints.
> If `node_modules/.bin` is not already on your PATH, prefix the commands below
> with `node_modules/.bin/` to ensure the bundled binary is used.
```

> Need stricter guardrails? `scripts/subtree/add.sh` wraps the git command with
> clean-worktree checks and requires explicit `--force-remove` before replacing
> an existing `.shared` directory. Run `bash path/to/scripts/subtree/add.sh --help`
> for usage and available safety flags.

### Manual Installation

1. Clone this repository into your project:
```bash
git clone https://github.com/dtrinity/shared-hardhat-tools.git .shared
```

2. Add to package.json:
```json
{
  "dependencies": {
    "@dtrinity/shared-hardhat-tools": "file:./.shared"
  }
}
```

3. Install dependencies:
```bash
npm install

# ts-node and typescript ship with the shared package, so no extra installs are required
```

### End-to-End Subtree Workflow

#### First-Time Integration

1. **Prepare the repo** – ensure the worktree is clean and Hardhat compiles locally. Decide where the subtree should live (the examples below assume `.shared`).
2. **Add the subtree** – run `bash scripts/subtree/add.sh --repo-url https://github.com/dtrinity/shared-hardhat-tools.git --branch main --prefix .shared`. The helper aborts if the target directory exists unless you pass `--force-remove`.
3. **Install the package** – execute `npm install file:./.shared` (or the equivalent `yarn/pnpm` command). This pulls in the bundled `ts-node` runtime automatically.
4. **Run a minimal setup pass** – start with `node_modules/.bin/ts-node .shared/scripts/setup.ts --package-scripts` to add the shared npm scripts and surface any preflight issues. Add `--hooks`, `--configs`, or `--ci` once you are ready to opt in.
5. **Smoke-test the integration** – run targeted checks (`lint:eslint`, `sanity:deploy-ids`, `guardrails:check --skip-prettier`) to confirm the shared tooling executes inside the consumer repository before committing the subtree.

#### Updating to the Latest Version

1. **Sync from the source repo** – from the network repository, call `bash .shared/scripts/subtree/update.sh --repo-url ../shared-hardhat-tools --branch main` (or point at the upstream URL). Add `--stash` if you have local changes you want preserved.
2. **Install dependency updates** – rerun your package manager if `package.json` or lockfiles changed inside `.shared`.
3. **Re-run setup for affected phases** – `node_modules/.bin/ts-node .shared/scripts/setup.ts --package-scripts --hooks --configs` ensures new defaults land without overwriting local overrides.
4. **Validate guardrails** – execute `npm run --prefix .shared test` and a representative guardrail command (`npm run --prefix .shared guardrails:check -- --fail-fast`) before merging the subtree update.
5. **Commit intentionally** – commit only the `.shared` diff (and any follow-up package manager updates) with context so downstream reviewers understand the bump.

### What the Setup Script Does

Running `node_modules/.bin/ts-node .shared/scripts/setup.ts` performs a preflight check to verify the repository:

- Is a git worktree with the `.shared` subtree in place.
- Contains a `hardhat.config.*` file.
- Has a readable `package.json`.

If the preflight succeeds, the script:

- Ensures the baseline npm scripts exist (adds `analyze:shared`, `lint:*`, `guardrails:check`, and `shared:update`).
- Installs shared git hooks, configuration files, and the guardrail CI workflow, unless you restrict the phases with flags.
- Produces a summary of what was installed, skipped, or requires manual follow-up. Use `--force` to overwrite conflicting assets.

Run with phase flags to narrow the scope: `--package-scripts`, `--hooks`, `--configs`, and `--ci` can be combined as needed. `--all` remains available for explicit installs.

## Usage

### Running Security Analysis

```bash
# Ensure Slither is installed (uses pipx/pip under the hood)
node_modules/.bin/ts-node .shared/scripts/analysis/install-slither.ts

# Run all security checks
npm run --prefix .shared analyze:all

# Shared Slither workflows (mirrors Sonic's Makefile targets)
npm run --prefix .shared slither:default
npm run --prefix .shared slither:check
node_modules/.bin/ts-node .shared/scripts/analysis/slither.ts focused --contract contracts/example.sol

# Individual tools
npm run --prefix .shared slither
npm run --prefix .shared mythril
npm run --prefix .shared solhint

# With network-specific configs
npm run --prefix .shared slither -- --network mainnet
```

### Sanity Checks

```bash
# Detect hard-coded deployment IDs in deploy scripts
npm run --prefix .shared sanity:deploy-ids

# Remove deployment artifacts that match one or more keywords (dry run by default)
npm run --prefix .shared sanity:deploy-clean -- \
  --network mainnet \
  --keywords Vault Alpha \
  --dry-run

# Emit a markdown or JSON summary of contract addresses for a network
npm run --prefix .shared sanity:deploy-addresses -- \
  --network mainnet \
  --output reports/contract-addresses.md

# Aggregate oracle addresses by category (customisable via --category/--exclude)
npm run --prefix .shared sanity:oracle-addresses -- \
  --network mainnet \
  --category Chainlink=Chainlink \
  --exclude Chainlink=Mock \
  --output reports/oracle-addresses.json --json

# Generate a normalized SLOC report for all Solidity contracts
npm run --prefix .shared metrics:nsloc

# Generate a JSON report alongside the check
node_modules/.bin/ts-node .shared/scripts/deployments/find-hardcoded-deploy-ids.ts --report reports/deploy-ids.json

# Override defaults when a repo stores deploy IDs elsewhere
node_modules/.bin/ts-node .shared/scripts/deployments/find-hardcoded-deploy-ids.ts \
  --deploy-ids packages/core/deploy-ids.ts \
  --deploy-root deploy/scripts --extensions .ts,.js
```

The sanity checker looks for constants exported from `deploy-ids.ts` (or a path
you provide) and flags deploy scripts that inline the literal value instead of
using the shared constant. Use `--report` to emit machine-readable findings for
CI summaries or downstream tooling. `sanity:deploy-clean` supports safe
dry-runs (`--dry-run`) and operates on alternate deployment roots via
`--deployments-dir`. The contract and oracle reporters emit markdown by default;
pass `--json` to integrate with automation, or provide categories with
`--category Name=Pattern1,Pattern2` and optional exclusions such as
`--exclude Name=PatternToSkip`. `metrics:nsloc` stores a markdown summary at
`reports/nsloc.md` unless you override `--output`.

### Running Linting Checks

```bash
# Check formatting
npm run --prefix .shared lint:prettier

# Run ESLint
npm run --prefix .shared lint:eslint

# Run both
npm run --prefix .shared lint:all
```

### Using in TypeScript Code

```typescript
import { configLoader, logger, validateHardhatProject } from '@dtrinity/shared-hardhat-tools';

// Load configuration
const slitherConfig = configLoader.loadConfig('slither', { network: 'mainnet' });

// Validate project setup
const validation = validateHardhatProject();
if (!validation.valid) {
  logger.error('Project validation failed:', validation.errors);
}

// Run analysis programmatically
import { runSlither } from '@dtrinity/shared-hardhat-tools/scripts/analysis/slither';
const success = runSlither({ network: 'mainnet', failOnHigh: true });
```

### Manifest-Driven Role Transfers

The shared runner migrates `Ownable` ownership and `DEFAULT_ADMIN_ROLE` by reading a manifest instead of bespoke scripts. Version 2 manifests default to auto-including every contract the deployer still controls and let you opt out with targeted exclusions or overrides. A minimal example:

```json
{
  "version": 2,
  "deployer": "0xDeployer...",
  "governance": "0xGovernance...",
  "autoInclude": { "ownable": true, "defaultAdmin": true },
  "defaults": {
    "ownable": { "newOwner": "{{governance}}" },
    "defaultAdmin": {
      "newAdmin": "{{governance}}",
      "remove": { "strategy": "renounce", "execution": "direct", "address": "{{deployer}}" }
    }
  },
  "safe": {
    "safeAddress": "0xSafe...",
    "owners": ["0xGovernor1...", "0xGovernor2..."],
    "threshold": 2,
    "chainId": 8453,
    "description": "DEFAULT_ADMIN_ROLE cleanup"
  },
  "exclusions": [
    { "deployment": "PausedContract", "ownable": true, "reason": "Keep under deployer until audit" }
  ],
  "overrides": [
    {
      "deployment": "SpecialContract",
      "defaultAdmin": {
        "enabled": true,
        "remove": { "strategy": "revoke", "execution": "safe", "address": "{{deployer}}" }
      }
    }
  ]
}
```

- `{{deployer}}` and `{{governance}}` placeholders resolve to the manifest addresses.
- `autoInclude` determines the default sweep; exclusions and overrides explicitly change the plan.
- `ownable.execution` must stay `direct`; Safe batches cannot call `transferOwnership`.
- Setting `remove.execution` to `safe` automatically switches to `revokeRole` and queues Safe transactions.

Before running the CLI, add `roles.deployer` and `roles.governance` to your Hardhat network config. The shared scripts fall back to these values when the CLI flags are omitted, and refuse to run if neither source is provided.

Usage:

```bash
# Preview + execute direct ownership/admin transfers
ts-node .shared/scripts/roles/transfer-roles.ts --manifest manifests/roles.mainnet.json --network mainnet

# Preview + queue Safe revokeRole transactions only
ts-node .shared/scripts/roles/revoke-roles.ts --manifest manifests/roles.mainnet.json --network mainnet

# Dry-run without touching chain
ts-node .shared/scripts/roles/transfer-roles.ts --manifest manifests/roles.mainnet.json --network mainnet --dry-run-only

# Scan for new deployments and fail CI if coverage is missing
ts-node .shared/scripts/roles/scan-roles.ts --manifest manifests/roles.mainnet.json --network mainnet --deployer 0xDeployer... --governance 0xGovernance... --drift-check
```

Each command performs a guarded dry-run first, printing the planned changes and listing any remaining non-admin roles so governance can follow up manually. Supply `--json-output report.json` to persist an execution summary alongside console output.

### Setting Up Git Hooks

```bash
# Install just the shared hooks (skips configs/CI/package scripts)
node_modules/.bin/ts-node .shared/scripts/setup.ts --hooks

# Force overwrite existing hooks
node_modules/.bin/ts-node .shared/scripts/setup.ts --hooks --force
```

The shared pre-commit hook runs the guardrail suite (Prettier, ESLint, Solhint) and checks staged Solidity/tests for
`console.log` or lingering `.only`. Prettier runs by default—set `SHARED_HARDHAT_PRE_COMMIT_PRETTIER=0` to skip it
temporarily. Contract compilation is also enabled unless you opt out (`SHARED_HARDHAT_PRE_COMMIT_COMPILE=0`).

The pre-push hook reruns guardrails (Prettier enabled by default—set
`SHARED_HARDHAT_PRE_PUSH_PRETTIER=0` to skip), executes tests by default (opt out with
`SHARED_HARDHAT_PRE_PUSH_TEST=0`), and requires Slither only on long-lived branches (`main`, `master`, `develop`).
Customize the test command via `SHARED_HARDHAT_PRE_PUSH_TEST_CMD="yarn test --runInBand"`.

### Updating Shared Tools

```bash
# Update subtree to latest version (requires clean worktree by default)
bash .shared/scripts/subtree/update.sh

# Opt-in helpers for common workflows
bash .shared/scripts/subtree/update.sh --stash       # auto-stash + restore
bash .shared/scripts/subtree/update.sh --allow-dirty # bypass clean check entirely

# Or use npm script if configured
npm run shared:update
```

> The helper never runs package installs or git hook sync automatically. After
> updating, review the diff, run your package manager if `package.json` moved,
> and re-run `node_modules/.bin/ts-node .shared/scripts/setup.ts` for any phases
> that need to pick up new assets.

## Configuration

### Project-Specific Overrides

Create configuration files in your project root to override shared configs:

- `eslint.config.*` or `.eslintrc.*` - ESLint configuration (shared default: `.shared/configs/eslint.config.mjs`)
- `prettier.config.*` or `.prettierrc.*` - Prettier options (shared default: `.shared/configs/prettier.config.cjs`)
- `.slither.json` - Slither configuration
- `.solhint.json` - Solhint rules
- `.mythril.json` - Mythril settings

### Environment Variables

- `LOG_LEVEL` - Set logging verbosity (ERROR, WARN, INFO, DEBUG, VERBOSE)
- `HARDHAT_NETWORK` - Specify network for configurations
- `CI` - Automatically detected in CI environments

## CI Integration

### GitHub Actions

Add the shared workflow to your repository:

```yaml
# .github/workflows/security.yml
name: Security Checks

on: [push, pull_request]

jobs:
  shared-guardrails:
    uses: ./.shared/ci/shared-guardrails.yml
```

The shared workflow runs three focused jobs—lint & sanity checks (including the
deploy ID detector), Hardhat compilation, and tests—before publishing a status
summary. If your deploy IDs live somewhere other than `typescript/deploy-ids.ts`
and `deploy/`, add a `sanity:deploy-ids` npm script that invokes the shared
checker with the appropriate `--deploy-ids`/`--deploy-root` arguments so CI can
continue to enforce the invariant.

### Custom Integration

```yaml
- name: Run Shared Security Checks
  run: |
    npm install file:./.shared
    npm run --prefix .shared analyze:all --fail-fast
```

### Recommended CI Wiring

1. **Reference the shared workflow** – keep the workflow in the repo via the setup script (`--ci`) so `uses: ./.shared/ci/shared-guardrails.yml` always matches the subtree contents.
2. **Verify shared scripts** – ensure `npm run guardrails:check`, `sanity:deploy-ids`, and the `lint:*` entries exist (or have repo-specific equivalents) before enabling the workflow. The setup script reports gaps without overwriting customized commands.
3. **Install shared dependencies** – run `npm install file:./.shared` or `yarn add file:./.shared` in CI so the bundled `ts-node` runtime is present when the workflow calls TypeScript scripts.
4. **Publish artifacts** – keep `reports/` ignored locally; the workflow uploads its contents automatically for debugging failed runs.
5. **Extend downstream** – add repo-specific jobs (deployments, simulations) in the same workflow once the shared guardrails path is passing consistently.

## Directory Structure

```
.shared/
├── configs/           # Shared configuration files
├── scripts/
│   ├── analysis/     # Security analysis scripts
│   ├── linting/      # Code quality scripts
│   ├── subtree/      # Subtree management
│   └── setup.ts      # Setup script
├── lib/              # Utility libraries
├── hooks/            # Git hooks
├── ci/               # CI/CD templates
└── package.json      # Package configuration
```

## Network-Specific Integration

Each network repository should:

1. Add shared-hardhat-tools as a subtree
2. Maintain network-specific configurations alongside shared ones
3. Use shared scripts with network-specific parameters
4. Commit subtree updates intentionally

Example integration:
```bash
# Sonic network
npm run --prefix .shared slither -- --network sonic

# Ethereum network
npm run --prefix .shared slither -- --network ethereum
```

## Release Cadence

Shared-hardhat-tools should publish incremental updates on a predictable rhythm so network repositories can plan their subtree refreshes:

1. **Batch changes every week** – merge improvements into `main` behind feature branches, keeping the WIP checklist up to date.
2. **Dogfood in Sonic** – sync `.shared` into `sonic-solidity-contracts@test-shared-tools-integration`, run `npm test` and representative guardrail scripts, and record any manual steps uncovered.
3. **Tag and announce** – once Sonic passes, create a semantic tag (`git tag v1.X.Y && git push origin v1.X.Y`) and share a short change log (docs, scripts touched, required downstream actions).
4. **Propagate downstream** – open subtree update PRs for each Hardhat repo, linking to the release notes and highlighting follow-up commands (`setup.ts` phases, new scripts).
5. **Archive learnings** – update `WIP.md` with the release summary and close the loop on lingering TODOs before starting the next batch.

### Multi-Repo Validation Flow

- Run the shared validation matrix before tagging to ensure guardrails still pass in every Hardhat repo.
- Defaults cover `lint`, `compile`, and `test`; add `--task` flags or per-repo overrides to widen or narrow the sweep.
- Use `--install` (or per-repo `install: true`) when the matrix should refresh dependencies ahead of execution.
- Emit a JSON report alongside release notes so downstream owners can see which repos were exercised and how long each task took.
- `configs/validation.networks.json` tracks the current dTrinity Hardhat fleet (lint + compile with installs); copy and adjust it when onboarding new repos.

```bash
# Quick check: validate Sonic only
npm run validate:matrix -- --repo sonic=../sonic-solidity-contracts

# Config-driven run covering multiple repos
npm run validate:matrix -- --config configs/validation.sample.json --install --report reports/validation.json
npm run validate:matrix -- --config configs/validation.networks.json --report reports/validation.json
```

- The optional config file (`configs/validation.sample.json`) documents the expected shape: a shared task list plus repo-specific `path`, `tasks`, `install`, and `commands` overrides.
- Fallback commands call the shared CLIs through `npx`, so you can lint/compile even if a repo hasn’t run `yarn install` yet.
- Commands still auto-detect `npm`, `yarn`, or `pnpm` to respect existing `package.json` scripts and stop after the first failure so you can triage before cascading updates further downstream.

## Contributing

To contribute to shared tools:

1. Clone this repository directly
2. Make changes and run `npm test` to ensure type-checks and smoke tests pass
3. Create a pull request
4. After merge, network repos can update their subtrees

## Troubleshooting

### Subtree conflicts

If you encounter merge conflicts when updating:
```bash
git status  # Check conflicting files
git add -A  # Stage resolved conflicts
git commit  # Complete the merge
```

### Missing dependencies

Ensure shared tools are installed:
```bash
npm install file:./.shared
```

### Yarn install fails with ENOENT inside node_modules

If a previous `npm install` populated `node_modules`, Yarn 4 may fail with errors like `ENOENT: no such file or directory, lstat '.../node_modules/cacache/node_modules/glob/dist'`. Remove the stale folder and reinstall with Yarn:
```bash
rm -rf node_modules
yarn install
```

### Hook permissions

Make hooks executable:
```bash
chmod +x .git/hooks/pre-commit
chmod +x .git/hooks/pre-push
```

## License

MIT
