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
```

### 2. Test Basic Functionality

```bash
# Test that the package is accessible
npx ts-node -e "const tools = require('@dtrinity/shared-hardhat-tools'); console.log('Tools loaded:', Object.keys(tools));"

# Test a simple script
npx ts-node .shared/scripts/analysis/solhint.ts --help 2>/dev/null || echo "Script executable"
```

### 3. Conservative Integration Steps

Start with these minimal changes:

#### A. Add Package Scripts (package.json)
```json
{
  "scripts": {
    "analyze:shared": "ts-node .shared/scripts/analysis/run-all.ts",
    "shared:update": "bash .shared/scripts/subtree/update.sh"
  }
}
```

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
npx ts-node .shared/scripts/analysis/solhint.ts --quiet --max-warnings 0 || true
```

## Important Context for AI Agents

### DO NOT on First Integration:
- ❌ Do not overwrite existing configurations
- ❌ Do not install git hooks initially
- ❌ Do not modify CI/CD workflows yet
- ❌ Do not run security scans that might fail the build

### DO on First Integration:
- ✅ Add subtree at .shared
- ✅ Install as npm dependency
- ✅ Add 1-2 non-invasive npm scripts
- ✅ Test that imports work
- ✅ Commit changes with clear message

### Testing Commands (Safe)

These commands are safe to run and won't modify files:

```bash
# List available scripts
ls .shared/scripts/analysis/

# Check TypeScript compilation
npx tsc --noEmit --project .shared/tsconfig.json

# Test imports
npx ts-node -e "
const { logger, configLoader } = require('@dtrinity/shared-hardhat-tools');
logger.info('Shared tools integrated successfully');
"
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

- [ ] Set up git hooks: `npx ts-node .shared/scripts/setup.ts --hooks`
- [ ] Add shared CI workflow: `cp .shared/ci/shared-guardrails.yml .github/workflows/`
- [ ] Configure network-specific overrides
- [ ] Run full security analysis: `npm run analyze:shared`
- [ ] Document in project README

## Troubleshooting for AI Agents

### Error: "Cannot find module '@dtrinity/shared-hardhat-tools'"
**Solution**: Run `npm install file:./.shared`

### Error: "fatal: prefix '.shared' already exists"
**Solution**: Directory exists, either remove it or use different prefix

### Error: "ts-node: command not found"
**Solution**: Ensure ts-node is installed: `npm install -D ts-node typescript`

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