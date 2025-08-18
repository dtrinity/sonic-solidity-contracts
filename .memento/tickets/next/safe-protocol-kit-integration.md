# Safe Protocol Kit Integration for Automated Governance Operations

**Status**: Next  
**Priority**: High  
**Category**: Infrastructure  
**Estimated Effort**: 2-3 weeks  

## Problem Statement

The dTRINITY protocol currently requires **manual intervention** for governance wallet (Safe multisig) operations. It's important to distinguish between two types of operations:

### Operations That DO NOT Need Safe SDK (Deployer → Governance Transfers):

These are operations where the deployer wallet transfers roles TO the governance wallet. The deployer can sign these locally:

1. **Role Transfer Scripts** (Deploy scripts in `deploy/04_assign_roles_to_multisig/`):
   - `01_transfer_dstable_roles_to_multisig.ts` - Transfers dStable ecosystem roles
   - `02_transfer_oracle_roles_to_multisig.ts` - Transfers oracle aggregator roles  
   - `03_transfer_dlend_roles_to_multisig.ts` - Transfers dLend ACL and ownership
   - `04_transfer_oracle_wrapper_roles_to_multisig.ts` - Transfers oracle wrapper roles
   - `deploy/08_dstake/05_transfer_dstake_roles_to_multisig.ts` - Transfers dStake roles

**Current Status**: These are already automated with idempotency checks and work correctly.

### Operations That DO Need Safe SDK (Governance Wallet Execution):

These are operations where the governance wallet needs to sign and execute transactions:

1. **Post-Transfer Configuration** (Critical Path Blockers):
   - **IssuerV2/RedeemerV2 Setup** (`deploy/15_issue_redeem_v2/*.ts`): After governance receives admin roles, the deployer can no longer grant/revoke roles on these contracts
   - These scripts collect failed operations in a `manualActions` array that outputs "Manual actions required to finalize setup"
   - Example operations: `ERC20StablecoinUpgradeable.grantRole(MINTER_ROLE, address)`, `IssuerV2.revokeRole(role, deployerAddress)`

2. **Future Governance Operations**:
   - Protocol parameter updates
   - Emergency operations
   - Contract upgrades
   - Oracle feed updates

### Pain Points:
- **Async Execution Challenge**: Governance signing is asynchronous - deployment scripts finish but governance transactions remain queued
- **Execution Order Dependencies**: Safe transactions must be executed in correct order to avoid failures
- **Idempotency Requirements**: Deploy scripts must handle cases where they're re-run after partial governance execution
- **Manual Intervention**: Currently requires manual creation and signing of Safe transactions
- **No Transaction Batching**: Each operation requires separate manual signing

## Proposed Solution

Integrate **Safe Protocol Kit SDK** to automate multi-signature governance operations, replacing manual signing processes with programmatic transaction management that maintains security through built-in multi-signature validation.

### Key Benefits:
- **Automated Role Management**: Programmatically execute role transfers and governance operations
- **Transaction Batching**: Bundle multiple operations into single atomic transactions
- **Enhanced Security**: Built-in multi-signature validation with tamper-proof transaction construction
- **Developer Experience**: Full TypeScript support with comprehensive type safety
- **Deployment Automation**: Enable fully automated deployment pipelines
- **Audit Trail**: Improved transaction tracking and governance transparency

## Scope

### Files Requiring Modification:

#### 1. Scripts That Need Safe SDK Integration (Governance Wallet Operations):
- `deploy/15_issue_redeem_v2/1_setup_issuerv2.ts` - Parse and execute manualActions array
- `deploy/15_issue_redeem_v2/2_setup_redeemerv2.ts` - Parse and execute manualActions array

#### 2. Scripts That DO NOT Need Modification (Deployer Operations):
The following scripts already work correctly and don't need Safe SDK since the deployer signs locally:
- `deploy/04_assign_roles_to_multisig/01_transfer_dstable_roles_to_multisig.ts`
- `deploy/04_assign_roles_to_multisig/02_transfer_oracle_roles_to_multisig.ts`  
- `deploy/04_assign_roles_to_multisig/03_transfer_dlend_roles_to_multisig.ts`
- `deploy/04_assign_roles_to_multisig/04_transfer_oracle_wrapper_roles_to_multisig.ts`
- `deploy/08_dstake/05_transfer_dstake_roles_to_multisig.ts`

#### 3. Configuration Files:
- `config/networks/sonic_mainnet.ts` - Add Safe configuration
- `config/networks/sonic_testnet.ts` - Add Safe configuration  
- `config/types.ts` - Add Safe-specific types

#### 4. New Files to Create:
- `typescript/safe/SafeManager.ts` - Core Safe interaction wrapper
- `typescript/safe/types.ts` - Safe-specific type definitions
- `scripts/safe/execute-governance-batch.ts` - Batch execution utility
- `scripts/safe/propose-governance-transaction.ts` - Transaction proposal utility

#### 5. Package Dependencies:
- `package.json` - Add Safe Protocol Kit dependencies

## Async Execution and Idempotency Requirements

### Critical Design Considerations:

1. **Asynchronous Governance Signing**:
   - Deploy scripts complete immediately after creating Safe transactions
   - Governance multisig signers review and sign transactions asynchronously
   - Transactions may be executed hours or days after creation
   - Scripts must NOT block waiting for governance signatures

2. **Execution Order Dependencies**:
   - Safe transactions must maintain correct execution order
   - Example: Must grant role before revoking from another address
   - Transactions should be numbered or include nonce for ordering
   - Failed transactions should not block subsequent valid operations

3. **Idempotency Requirements**:
   - Deploy scripts must be re-runnable without duplicating transactions
   - Check if Safe transaction already exists before creating new one
   - Verify on-chain state before proposing governance operations
   - Example flow:
     ```typescript
     // First run: Script creates Safe transaction and exits
     if (!hasRole(MINTER_ROLE, newAddress)) {
       await safeManager.proposeTransaction(grantMinterRole);
       console.log("Safe transaction proposed, awaiting governance execution");
       return false; // Script indicates incomplete
     }
     
     // Second run (after governance executes): Script detects role granted
     if (hasRole(MINTER_ROLE, newAddress)) {
       console.log("Role already granted via governance");
       return true; // Script indicates complete
     }
     ```

4. **Script Completion Strategy**:
   - Scripts should return status indicating if governance action is pending
   - Use deployment state tracking to record pending Safe transactions
   - On re-run, check if pending transactions were executed
   - Only proceed with dependent operations after governance execution

5. **Transaction Tracking**:
   - Store Safe transaction hashes in deployment artifacts
   - Track transaction status (proposed, signed, executed)
   - Provide visibility into pending governance operations
   - Enable querying of transaction execution status

## Implementation Plan

### Phase 1: Setup and Core Infrastructure (Week 1)
1. **Install Dependencies**
   ```bash
   yarn add @safe-global/protocol-kit @safe-global/api-kit @safe-global/types-kit
   ```

2. **Create Safe Manager Wrapper** (`typescript/safe/SafeManager.ts`):
   - Initialize Safe Protocol Kit with Sonic network configuration
   - Implement transaction creation, signing, and execution methods
   - Add transaction batching capabilities
   - Include error handling and validation

3. **Update Configuration**:
   - Add Safe addresses to network configurations
   - Add Safe-specific environment variables and types
   - Update `config/types.ts` with Safe configuration interfaces

4. **Create Utility Scripts**:
   - `scripts/safe/execute-governance-batch.ts` - For executing batched transactions
   - `scripts/safe/propose-governance-transaction.ts` - For proposing transactions to other signers

### Phase 2: Integration with Governance Operations (Week 2)
1. **Update IssuerV2/RedeemerV2 Setup Scripts**:
   - Parse `manualActions` array and convert to Safe transactions
   - Implement idempotency checks before creating transactions
   - Add transaction status tracking in deployment artifacts
   - Handle script re-runs after partial governance execution

2. **Implement Async Handling**:
   - Create mechanism to track pending Safe transactions
   - Add status checks for governance execution completion
   - Implement graceful failure with clear status reporting
   - Enable scripts to resume after governance signs

3. **Testing**:
   - Test idempotent script execution
   - Validate transaction ordering and dependencies
   - Test re-run scenarios with partial governance execution
   - Validate against sonic_testnet before mainnet deployment

### Phase 3: Testing and Deployment (Week 3)
1. **Documentation**:
   - Update deployment documentation with Safe procedures
   - Document the new async deployment workflow
   - Create runbook for governance signers

2. **Production Deployment**:
   - Deploy and test on sonic_testnet
   - Coordinate with governance multisig signers for testing
   - Execute controlled migration to production environment

## Technical Details

### Safe Configuration Structure:
```typescript
interface SafeConfig {
  safeAddress: string;
  owners: string[];
  threshold: number;
  chainId: number;
  rpcUrl: string;
  txServiceUrl?: string;
}
```

### Transaction Batching Example:
```typescript
const transactions = [
  // Grant admin role to multisig
  {
    to: contractAddress,
    value: '0',
    data: contract.interface.encodeFunctionData('grantRole', [adminRole, multisigAddress])
  },
  // Revoke admin role from deployer
  {
    to: contractAddress,
    value: '0', 
    data: contract.interface.encodeFunctionData('revokeRole', [adminRole, deployerAddress])
  }
];

const safeTransaction = await safeManager.createBatchTransaction(transactions);
```

### Integration Points:
1. **Hardhat Deploy Integration**: Seamless integration with existing deployment scripts
2. **Network Configuration**: Support for sonic_mainnet, sonic_testnet, and localhost
3. **Error Handling**: Comprehensive error handling with rollback capabilities
4. **Validation**: Pre-execution validation of transaction parameters and contract state

## Acceptance Criteria

### ✅ Core Functionality:
- [ ] Safe Protocol Kit successfully initializes with Sonic network configuration
- [ ] All role transfer operations can be executed through Safe transactions
- [ ] Transaction batching works correctly for multi-step operations
- [ ] Manual confirmation prompts are replaced with Safe transaction creation

### ✅ Security & Validation:
- [ ] All transactions are validated before execution
- [ ] Multi-signature threshold requirements are enforced
- [ ] Transaction simulation prevents failed executions
- [ ] Sensitive operations require proper multi-signature approval

### ✅ Integration & Compatibility:
- [ ] Existing deployment scripts work with Safe integration
- [ ] Backward compatibility maintained during transition
- [ ] Network configurations support both manual and automated modes
- [ ] Integration works across sonic_mainnet, sonic_testnet, and localhost

### ✅ Testing & Quality Assurance:
- [ ] Comprehensive test suite covers all Safe operations
- [ ] Role transfer scenarios tested end-to-end
- [ ] Gas estimation and optimization verified
- [ ] Error handling and edge cases tested

### ✅ Documentation & Deployment:
- [ ] Updated deployment documentation includes Safe procedures
- [ ] Governance operations playbook completed
- [ ] Successfully tested on sonic_testnet
- [ ] Production deployment completed without issues

## Risk Assessment

### High Risk Areas:
1. **Transaction Execution Failures**: Safe transactions may fail if not properly constructed
   - **Mitigation**: Implement comprehensive transaction simulation and validation
   
2. **Multi-Signature Coordination**: Requires coordination between multiple signers
   - **Mitigation**: Use Safe Transaction Service for asynchronous signing workflows

3. **Network Compatibility**: Safe may not have full support for Sonic network
   - **Mitigation**: Test thoroughly on testnet, implement fallback to manual process if needed

### Medium Risk Areas:
1. **Configuration Errors**: Incorrect Safe addresses or network configurations
   - **Mitigation**: Implement strict validation and verification steps

2. **Gas Estimation Issues**: Safe transactions may require different gas calculations
   - **Mitigation**: Implement proper gas estimation with buffer margins

### Low Risk Areas:
1. **Backward Compatibility**: Changes may affect existing processes
   - **Mitigation**: Maintain dual-mode support during transition period

## Dependencies

### External Dependencies:
- Safe Protocol Kit SDK packages
- Sonic network RPC endpoints
- Safe Transaction Service (if available for Sonic)

### Internal Dependencies:
- Existing deployment script infrastructure
- Network configuration system
- Contract ABI and deployment artifacts

### Team Dependencies:
- Coordination with governance multisig signers for testing
- DevOps support for environment configuration
- Security review of automated governance processes

## Success Metrics

1. **Automation Level**: 100% of governance operations can be executed without manual intervention
2. **Execution Time**: 50% reduction in time required for role transfers and governance operations  
3. **Error Reduction**: 90% reduction in human errors during governance operations
4. **Transaction Efficiency**: 70% reduction in gas costs through transaction batching
5. **Security Compliance**: All operations maintain multi-signature security requirements

## Future Enhancements

1. **Governance Dashboard**: Web interface for managing Safe transactions
2. **Automated Monitoring**: Real-time monitoring of governance operations
3. **Cross-Chain Support**: Extend Safe integration to other networks
4. **Advanced Workflows**: Complex multi-step governance workflows
5. **Integration with Governance Protocols**: Connect with snapshot voting and proposal systems

---

**Next Steps**: 
1. Review and approve implementation plan
2. Set up development environment with Safe Protocol Kit
3. Begin Phase 1 implementation with core infrastructure setup
4. Schedule coordination meetings with governance multisig signers for testing