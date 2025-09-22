# Shared Hardhat Tools

Centralized development tools and security guardrails for dTrinity Hardhat projects. This package provides shared configurations, scripts, and workflows that can be integrated into network-specific repositories using git subtree.

## Features

- 🔍 **Static Analysis**: Integrated Slither, Mythril, and Solhint configurations
- 🎨 **Code Quality**: Shared linting and formatting configurations
- 🔒 **Security Guardrails**: Pre-commit and pre-push hooks
- 🚀 **CI/CD Templates**: GitHub Actions workflows for automated checks
- 📦 **TypeScript Support**: Full TypeScript implementation with ts-node
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

### Setting Up Git Hooks

```bash
# Install just the shared hooks (skips configs/CI/package scripts)
node_modules/.bin/ts-node .shared/scripts/setup.ts --hooks

# Force overwrite existing hooks
node_modules/.bin/ts-node .shared/scripts/setup.ts --hooks --force
```

The shared pre-commit hook runs the guardrail suite (Prettier, ESLint, Solhint) and checks staged Solidity/tests for
`console.log` or lingering `.only`. Prettier is skipped by default—set `SHARED_HARDHAT_PRE_COMMIT_PRETTIER=1` to turn it
on. Contract compilation is opt-in as well (`SHARED_HARDHAT_PRE_COMMIT_COMPILE=1`).

The pre-push hook reruns guardrails (Prettier disabled unless `SHARED_HARDHAT_PRE_PUSH_PRETTIER=1`), optionally
executes tests, and requires Slither only on long-lived branches (`main`, `master`, `develop`). Enable automated test
runs with `SHARED_HARDHAT_PRE_PUSH_TEST=1` or customize the command via
`SHARED_HARDHAT_PRE_PUSH_TEST_CMD="yarn test --runInBand"`.

### Updating Shared Tools

```bash
# Update subtree to latest version
bash .shared/scripts/subtree/update.sh

# Or use npm script if configured
npm run shared:update
```

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

### Custom Integration

```yaml
- name: Run Shared Security Checks
  run: |
    npm install file:./.shared
    npm run --prefix .shared analyze:all --fail-fast
```

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

## Contributing

To contribute to shared tools:

1. Clone this repository directly
2. Make changes and test locally
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

### Hook permissions

Make hooks executable:
```bash
chmod +x .git/hooks/pre-commit
chmod +x .git/hooks/pre-push
```

## License

MIT
