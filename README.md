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

# Run setup script
npx ts-node .shared/scripts/setup.ts --all
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
```

## Usage

### Running Security Analysis

```bash
# Run all security checks
npm run --prefix .shared analyze:all

# Run specific tools
npm run --prefix .shared slither
npm run --prefix .shared mythril
npm run --prefix .shared solhint

# With network-specific configs
npm run --prefix .shared slither -- --network mainnet
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
# Install git hooks
npx ts-node .shared/scripts/setup.ts --hooks

# Force overwrite existing hooks
npx ts-node .shared/scripts/setup.ts --hooks --force
```

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