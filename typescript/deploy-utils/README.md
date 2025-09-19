# State-Checked Mutations Utility

A TypeScript utility for making Hardhat deploy scripts **idempotent** and **safe** for persistent-net deployments.

## 🎯 Purpose

Prevents deploy script failures from:
- **Non-idempotent behavior**: Scripts that fail when run multiple times
- **Permission changes**: When deployer loses admin rights after initial deployment
- **Network interruptions**: When scripts need to be re-run after partial execution
- **Unnecessary gas costs**: Avoiding duplicate transactions for already-configured state

## 🚀 Quick Start

### Basic Usage

```typescript
import { executeStateCheckedMutation, ContractMutationFactory } from "../typescript/deploy-utils/state-checked-mutations";

// Simple oracle setting
await executeStateCheckedMutation(
  ContractMutationFactory.setOracle(oracleAggregator, assetAddress, oracleAddress)
);

// Custom mutation
await executeStateCheckedMutation({
  description: "Set flash loan premium total",
  getCurrentState: () => poolContract.FLASHLOAN_PREMIUM_TOTAL(),
  expectedState: 500, // 5%
  executeMutation: () => poolConfiguratorContract.updateFlashloanPremiumTotal(500)
});
```

### Batch Operations

```typescript
import { executeStateCheckedMutationBatch } from "../typescript/deploy-utils/state-checked-mutations";

const mutations = assets.map(asset =>
  ContractMutationFactory.setOracle(oracleAggregator, asset.address, asset.oracle)
);

const results = await executeStateCheckedMutationBatch(mutations);
console.log(`${results.filter(r => r.executed).length} updates, ${results.filter(r => !r.executed).length} skipped`);
```

### Permission-Aware Mutations

```typescript
import { executePermissionAwareMutation } from "../typescript/deploy-utils/state-checked-mutations";

await executePermissionAwareMutation({
  description: "Grant MANAGER_ROLE to multisig",
  getCurrentState: () => contract.hasRole(MANAGER_ROLE, multisigAddress),
  expectedState: true,
  executeMutation: () => contract.grantRole(MANAGER_ROLE, multisigAddress),
  hasPermission: () => contract.hasRole(DEFAULT_ADMIN_ROLE, deployerAddress),
  manualInstruction: `contract.grantRole("${MANAGER_ROLE}", "${multisigAddress}") - requires DEFAULT_ADMIN_ROLE`
});
```

## 🔧 API Reference

### Core Functions

#### `executeStateCheckedMutation<T>(config: StateCheckedMutationConfig<T>): Promise<MutationResult>`

Executes a single mutation only if the current state differs from expected state.

**Config Parameters:**
- `description`: Human-readable description for logging
- `getCurrentState()`: Function that fetches current on-chain state
- `expectedState`: The target state value
- `executeMutation()`: Function that performs the blockchain transaction
- `stateComparator?`: Custom comparison function (optional)
- `waitForConfirmation?`: Whether to wait for tx confirmation (default: true)
- `logPrefix?`: Custom log prefix (default: "  ⚙️")

#### `executeStateCheckedMutationBatch(mutations: StateCheckedMutationConfig[]): Promise<MutationResult[]>`

Executes multiple mutations sequentially.

#### `executePermissionAwareMutation<T>(config: PermissionAwareMutationConfig<T>): Promise<PermissionAwareMutationResult>`

Like `executeStateCheckedMutation` but also checks permissions and provides manual instructions when permissions are insufficient.

### Factory Helpers

#### `ContractMutationFactory.setOracle(oracleAggregator, assetAddress, oracleAddress)`

Pre-configured mutation for oracle assignments.

#### `ContractMutationFactory.setAddress(contract, description, getCurrentAddress, setAddress, targetAddress)`

Pre-configured mutation for address assignments.

#### `ContractMutationFactory.grantRole(contract, description, role, account)`

Pre-configured mutation for role grants.

## 🎨 Design Principles

### 1. **Intuitive API**
```typescript
// Bad: Manual state checking
const currentOracle = await oracleAggregator.assetOracles(assetAddress);
if (currentOracle.toLowerCase() !== expectedOracle.toLowerCase()) {
  const tx = await oracleAggregator.setOracle(assetAddress, expectedOracle);
  await tx.wait();
  console.log(`Set oracle for ${assetAddress}`);
} else {
  console.log(`Oracle already set for ${assetAddress}`);
}

// Good: Declarative and clean
await executeStateCheckedMutation(
  ContractMutationFactory.setOracle(oracleAggregator, assetAddress, expectedOracle)
);
```

### 2. **Type Safety**
- Full TypeScript support with generics
- Compile-time checking for state types
- IntelliSense support for configuration

### 3. **Smart Defaults**
- Address comparison is case-insensitive by default
- BigInt/number comparison via string conversion
- Automatic transaction waiting
- Consistent logging format

### 4. **Flexibility**
- Custom state comparators for complex types
- Permission checking with manual instruction fallbacks
- Batch operations with summary reporting
- Extensible factory pattern

## 📋 Common Patterns

### Pattern 1: Oracle Configuration
```typescript
// Before (45 lines, manual state checking)
for (const [assetAddress, _] of Object.entries(feeds)) {
  const currentOracle = await oracleAggregator.assetOracles(assetAddress);
  if (currentOracle.toLowerCase() !== wrapperAddress.toLowerCase()) {
    const tx = await oracleAggregator.setOracle(assetAddress, wrapperAddress);
    await tx.wait();
    console.log(`Set oracle for ${assetAddress}`);
  } else {
    console.log(`Oracle already set for ${assetAddress}`);
  }
}

// After (5 lines, declarative)
const mutations = Object.keys(feeds).map(assetAddress =>
  ContractMutationFactory.setOracle(oracleAggregator, assetAddress, wrapperAddress)
);
await executeStateCheckedMutationBatch(mutations);
```

### Pattern 2: Role Management
```typescript
// Permission-aware role grants with manual fallback
await executePermissionAwareMutation({
  description: `Grant ${roleName} to ${account}`,
  getCurrentState: () => contract.hasRole(role, account),
  expectedState: true,
  executeMutation: () => contract.grantRole(role, account),
  hasPermission: () => contract.hasRole(DEFAULT_ADMIN_ROLE, deployer),
  manualInstruction: `contract.grantRole("${role}", "${account}") - requires DEFAULT_ADMIN_ROLE`
});
```

### Pattern 3: Complex State Objects
```typescript
await executeStateCheckedMutation({
  description: "Update pool configuration",
  getCurrentState: async () => ({
    fee: await pool.fee(),
    enabled: await pool.enabled(),
    admin: await pool.admin()
  }),
  expectedState: { fee: 300n, enabled: true, admin: multisigAddress },
  executeMutation: () => pool.updateConfig(300n, true, multisigAddress),
  stateComparator: (current, expected) => (
    current.fee.toString() === expected.fee.toString() &&
    current.enabled === expected.enabled &&
    current.admin.toLowerCase() === expected.admin.toLowerCase()
  )
});
```

## 🛡️ Safety Features

### 1. **Transaction Confirmation**
All mutations wait for transaction confirmation by default, preventing race conditions.

### 2. **Error Handling**
Comprehensive error handling with descriptive messages and context.

### 3. **Permission Checking**
Built-in support for permission validation with manual instruction fallbacks.

### 4. **State Validation**
Multiple comparison strategies for different data types (addresses, BigInt, arrays, objects).

### 5. **Idempotency**
Scripts can be safely re-run multiple times without side effects.

## 🔄 Migration Guide

### Migrating Existing Scripts

1. **Identify mutation patterns** in your deploy scripts
2. **Replace manual state checking** with utility calls
3. **Add permission checking** for admin operations
4. **Test on localhost** before deploying to persistent networks

### Example Migration

```typescript
// Before: Manual pattern
const currentPremium = await pool.FLASHLOAN_PREMIUM_TOTAL();
if (currentPremium.toString() !== config.premium.toString()) {
  const tx = await poolConfigurator.updateFlashloanPremiumTotal(config.premium);
  await tx.wait();
  console.log(`Updated premium from ${currentPremium} to ${config.premium}`);
} else {
  console.log(`Premium already set to ${config.premium}`);
}

// After: Utility pattern
await executeStateCheckedMutation({
  description: "Set flash loan premium total",
  getCurrentState: () => pool.FLASHLOAN_PREMIUM_TOTAL(),
  expectedState: config.premium,
  executeMutation: () => poolConfigurator.updateFlashloanPremiumTotal(config.premium)
});
```

## 🧪 Testing

The utility includes comprehensive state comparison logic and should be tested with:

1. **Different data types** (addresses, BigInt, booleans, arrays, objects)
2. **Permission scenarios** (admin rights present/absent)
3. **Network interruption scenarios** (partial script execution)
4. **Re-run scenarios** (full script re-execution)

## 🤝 Contributing

When adding new mutation patterns:

1. **Create factory methods** for common operations
2. **Add examples** to the examples file
3. **Document the pattern** in this README
4. **Consider permission implications** for the operation
5. **Test idempotency** thoroughly

## 📚 Best Practices

1. **Use descriptive descriptions** for better logging
2. **Group related mutations** into batches
3. **Handle permissions proactively** with manual instructions
4. **Test with different account permissions**
5. **Prefer factory methods** over manual configuration
6. **Always validate state assumptions** with custom comparators when needed