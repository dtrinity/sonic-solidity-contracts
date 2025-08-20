# Safe Protocol Kit SDK Integration Guide

## Overview

The Safe Protocol Kit is a comprehensive TypeScript SDK that enables programmatic interaction with Safe Smart Accounts (multi-signature wallets). This SDK is designed to replace manual governance operations by providing a robust, secure, and developer-friendly interface for creating, signing, and executing multi-signature transactions.

### Key Benefits for dTRINITY Protocol

- **Automated Governance**: Replace manual signing processes with programmatic transaction management
- **Enhanced Security**: Built-in multi-signature validation and secure transaction construction
- **Developer Experience**: Full TypeScript support with comprehensive type safety
- **Cross-Chain Support**: Unified interface across different blockchain networks
- **Integration Ready**: Seamless compatibility with existing ethers.js infrastructure

## Installation and Setup

### Package Installation

```bash
# Core Protocol Kit
npm install @safe-global/protocol-kit

# Additional utilities for transaction service integration
npm install @safe-global/api-kit
npm install @safe-global/types-kit

# Ethers.js for blockchain interaction
npm install ethers
```

### Environment Setup

```typescript
import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { ethers } from 'ethers'

// Initialize provider and signer
const provider = new ethers.JsonRpcProvider('https://rpc.sonic.fantom.network')
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider)
```

## Core Concepts

### Safe Account Initialization

The Protocol Kit supports two primary initialization modes:

1. **Existing Safe**: Connect to an already deployed Safe
2. **Predicted Safe**: Work with a Safe that will be deployed later

```typescript
// Connect to existing Safe
const protocolKit = await Safe.init({
  provider,
  signer,
  safeAddress: '0x1234...' // Your Safe address
})

// Initialize predicted Safe
const predictedSafe = {
  safeAccountConfig: {
    owners: ['0xOwner1...', '0xOwner2...', '0xOwner3...'],
    threshold: 2
  },
  safeDeploymentConfig: {
    saltNonce: 'unique-salt-value'
  }
}

const protocolKit = await Safe.init({
  provider,
  signer,
  predictedSafe
})
```

### Transaction Workflow

The Safe Protocol Kit follows a structured transaction workflow:

1. **Create Transaction**: Define transaction parameters
2. **Sign Transaction**: Collect required signatures
3. **Propose Transaction**: Submit to Safe Transaction Service (optional)
4. **Execute Transaction**: Execute when threshold is met

## API Reference

### Core Methods

#### Safe Initialization

```typescript
Safe.init(config: SafeConfig): Promise<Safe>
```

**Parameters:**
- `provider`: EIP-1193 provider or RPC URL
- `signer`: Wallet instance or private key
- `safeAddress`: Address of existing Safe (optional)
- `predictedSafe`: Configuration for undeployed Safe (optional)

#### Transaction Creation

```typescript
createTransaction(transactions: SafeTransactionDataPartial[]): Promise<SafeTransaction>
```

**Example:**
```typescript
const safeTransactionData = {
  to: '0xContractAddress...',
  value: '0',
  data: contractInterface.encodeFunctionData('functionName', [param1, param2])
}

const safeTransaction = await protocolKit.createTransaction(safeTransactionData)
```

#### Transaction Signing

```typescript
signTransaction(safeTransaction: SafeTransaction): Promise<SafeTransaction>
```

**Example:**
```typescript
const signedTransaction = await protocolKit.signTransaction(safeTransaction)
```

#### Transaction Execution

```typescript
executeTransaction(safeTransaction: SafeTransaction): Promise<TransactionResponse>
```

**Example:**
```typescript
const executionResult = await protocolKit.executeTransaction(signedTransaction)
await executionResult.wait()
```

### Safe Transaction Service Integration

For multi-signer workflows, integrate with Safe Transaction Service:

```typescript
import SafeApiKit from '@safe-global/api-kit'

// Initialize API Kit
const apiKit = new SafeApiKit({
  chainId: 146, // Sonic Network chain ID
  txServiceUrl: 'https://safe-transaction-sonic.safe.global' // If available
})

// Propose transaction for other signers
await apiKit.proposeTransaction({
  safeAddress: protocolKit.getAddress(),
  safeTransactionData: safeTransaction.data,
  safeTxHash: await protocolKit.getTransactionHash(safeTransaction),
  senderAddress: await signer.getAddress(),
  senderSignature: signedTransaction.signatures.get(await signer.getAddress())
})

// Confirm transaction (other signers)
await apiKit.confirmTransaction(safeTxHash, signature)
```

## Practical Examples

### Example 1: Contract Upgrade Transaction

```typescript
import Safe from '@safe-global/protocol-kit'
import { ethers } from 'ethers'

async function upgradeContract() {
  // Initialize Safe
  const protocolKit = await Safe.init({
    provider: new ethers.JsonRpcProvider('https://rpc.sonic.fantom.network'),
    signer: new ethers.Wallet(process.env.PRIVATE_KEY),
    safeAddress: process.env.SAFE_ADDRESS
  })

  // Contract interface for upgrade
  const proxyAdminABI = [
    'function upgrade(address proxy, address implementation) external'
  ]
  
  const proxyAdminInterface = new ethers.Interface(proxyAdminABI)
  
  // Create upgrade transaction
  const upgradeTransaction = {
    to: process.env.PROXY_ADMIN_ADDRESS,
    value: '0',
    data: proxyAdminInterface.encodeFunctionData('upgrade', [
      process.env.PROXY_ADDRESS,
      process.env.NEW_IMPLEMENTATION_ADDRESS
    ])
  }

  // Create and sign Safe transaction
  const safeTransaction = await protocolKit.createTransaction(upgradeTransaction)
  const signedTransaction = await protocolKit.signTransaction(safeTransaction)

  // Check if enough signatures collected
  const threshold = await protocolKit.getThreshold()
  if (signedTransaction.signatures.size >= threshold) {
    // Execute immediately if threshold met
    const result = await protocolKit.executeTransaction(signedTransaction)
    console.log('Transaction executed:', result.hash)
  } else {
    // Propose for additional signatures
    console.log('Transaction proposed, awaiting additional signatures')
    // Use Safe Transaction Service to collect more signatures
  }
}
```

### Example 2: Multi-Call Transaction

```typescript
async function executeMultipleOperations() {
  const protocolKit = await Safe.init({
    provider: new ethers.JsonRpcProvider('https://rpc.sonic.fantom.network'),
    signer: new ethers.Wallet(process.env.PRIVATE_KEY),
    safeAddress: process.env.SAFE_ADDRESS
  })

  // Multiple transaction data
  const transactions = [
    {
      to: '0xContract1...',
      value: '0',
      data: contract1Interface.encodeFunctionData('method1', [param1])
    },
    {
      to: '0xContract2...',
      value: ethers.parseEther('1.0'), // Send 1 ETH
      data: '0x' // Empty data for ETH transfer
    },
    {
      to: '0xContract3...',
      value: '0',
      data: contract3Interface.encodeFunctionData('method3', [param3])
    }
  ]

  // Create batch transaction
  const safeTransaction = await protocolKit.createTransaction(transactions)
  const signedTransaction = await protocolKit.signTransaction(safeTransaction)
  
  // Execute
  const result = await protocolKit.executeTransaction(signedTransaction)
  console.log('Batch transaction executed:', result.hash)
}
```

### Example 3: Role Management Transaction

```typescript
async function transferAdminRole() {
  const protocolKit = await Safe.init({
    provider: new ethers.JsonRpcProvider('https://rpc.sonic.fantom.network'),
    signer: new ethers.Wallet(process.env.PRIVATE_KEY),
    safeAddress: process.env.SAFE_ADDRESS
  })

  // AccessControl interface
  const accessControlABI = [
    'function grantRole(bytes32 role, address account) external',
    'function revokeRole(bytes32 role, address account) external',
    'function getRoleAdmin(bytes32 role) external view returns (bytes32)',
    'function DEFAULT_ADMIN_ROLE() external view returns (bytes32)'
  ]
  
  const contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    accessControlABI,
    protocolKit.getEthAdapter().getSigner()
  )

  // Get role constants
  const adminRole = await contract.DEFAULT_ADMIN_ROLE()
  
  const transactions = [
    // Grant admin role to new admin
    {
      to: process.env.CONTRACT_ADDRESS,
      value: '0',
      data: contract.interface.encodeFunctionData('grantRole', [adminRole, process.env.NEW_ADMIN_ADDRESS])
    },
    // Revoke admin role from current admin
    {
      to: process.env.CONTRACT_ADDRESS,
      value: '0',
      data: contract.interface.encodeFunctionData('revokeRole', [adminRole, process.env.CURRENT_ADMIN_ADDRESS])
    }
  ]

  const safeTransaction = await protocolKit.createTransaction(transactions)
  const signedTransaction = await protocolKit.signTransaction(safeTransaction)
  const result = await protocolKit.executeTransaction(signedTransaction)
  
  console.log('Role transfer completed:', result.hash)
}
```

## Advanced Features

### Custom Ethereum Adapter

For specialized provider configurations:

```typescript
import { EthersAdapter } from '@safe-global/protocol-kit'

const ethAdapter = new EthersAdapter({
  ethers,
  signerOrProvider: signer
})

const protocolKit = await Safe.init({
  ethAdapter,
  safeAddress: process.env.SAFE_ADDRESS
})
```

### Signature Collection Workflow

```typescript
async function collectSignatures(safeTransaction: SafeTransaction) {
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction)
  const signatures = new Map()
  
  // Collect signatures from multiple signers
  for (const signerPrivateKey of signerPrivateKeys) {
    const signerWallet = new ethers.Wallet(signerPrivateKey, provider)
    const signerKit = await Safe.init({
      provider,
      signer: signerWallet,
      safeAddress: process.env.SAFE_ADDRESS
    })
    
    const signature = await signerKit.signHash(safeTxHash)
    signatures.set(await signerWallet.getAddress(), signature)
  }
  
  // Add signatures to transaction
  signatures.forEach((signature, address) => {
    safeTransaction.addSignature(signature)
  })
  
  return safeTransaction
}
```

### Gas Estimation

```typescript
const gasEstimate = await protocolKit.estimateGas({
  safeTransaction,
  // Optional parameters
  gasPrice: '20000000000', // 20 Gwei
  gasLimit: '500000'
})

console.log('Estimated gas:', gasEstimate.totalGas)
```

## Security Considerations

### Signature Validation

1. **Verify Transaction Data**: Always validate transaction parameters before signing
2. **Check Safe State**: Ensure Safe configuration hasn't changed unexpectedly
3. **Validate Signers**: Verify all signatures come from authorized Safe owners

```typescript
// Validate transaction before signing
function validateTransaction(transaction: SafeTransactionDataPartial) {
  if (!ethers.isAddress(transaction.to)) {
    throw new Error('Invalid recipient address')
  }
  
  if (!transaction.data || transaction.data === '0x') {
    console.warn('Transaction contains no data')
  }
  
  // Add custom validation logic
}
```

### Safe Configuration Checks

```typescript
async function validateSafeConfig() {
  const owners = await protocolKit.getOwners()
  const threshold = await protocolKit.getThreshold()
  
  console.log('Safe owners:', owners)
  console.log('Required signatures:', threshold)
  
  // Validate expected configuration
  const expectedOwners = process.env.EXPECTED_OWNERS?.split(',') || []
  const unexpectedOwners = owners.filter(owner => !expectedOwners.includes(owner))
  
  if (unexpectedOwners.length > 0) {
    throw new Error(`Unexpected owners detected: ${unexpectedOwners.join(', ')}`)
  }
}
```

## Best Practices

### 1. Environment Configuration

```typescript
// Use environment variables for sensitive data
const CONFIG = {
  SAFE_ADDRESS: process.env.SAFE_ADDRESS!,
  RPC_URL: process.env.RPC_URL!,
  PRIVATE_KEYS: process.env.PRIVATE_KEYS!.split(','),
  CHAIN_ID: parseInt(process.env.CHAIN_ID || '146')
}
```

### 2. Error Handling

```typescript
async function executeSafeTransaction(transactionData: SafeTransactionDataPartial) {
  try {
    const safeTransaction = await protocolKit.createTransaction(transactionData)
    const signedTransaction = await protocolKit.signTransaction(safeTransaction)
    
    // Validate before execution
    await validateTransaction(transactionData)
    await validateSafeConfig()
    
    const result = await protocolKit.executeTransaction(signedTransaction)
    return result
  } catch (error) {
    if (error.code === 'INSUFFICIENT_FUNDS') {
      throw new Error('Safe has insufficient funds for transaction')
    } else if (error.message.includes('threshold')) {
      throw new Error('Not enough signatures collected')
    }
    throw error
  }
}
```

### 3. Transaction Simulation

```typescript
async function simulateTransaction(transactionData: SafeTransactionDataPartial) {
  // Use static call to simulate transaction
  const simulationResult = await provider.call({
    to: transactionData.to,
    data: transactionData.data,
    from: protocolKit.getAddress()
  })
  
  console.log('Simulation result:', simulationResult)
  return simulationResult
}
```

## Migration Strategy from Manual Signing

### Phase 1: Parallel Implementation

1. **Setup Safe Protocol Kit alongside existing manual processes**
2. **Test on non-critical operations first**
3. **Validate transaction outcomes match manual results**

### Phase 2: Gradual Transition

```typescript
// Create wrapper function for backward compatibility
async function executeGovernanceTransaction(
  contractAddress: string,
  functionName: string,
  params: any[],
  useAutomation = false
) {
  if (useAutomation && process.env.SAFE_AUTOMATION_ENABLED === 'true') {
    // Use Safe Protocol Kit
    return await executeSafeTransaction({
      to: contractAddress,
      value: '0',
      data: contractInterface.encodeFunctionData(functionName, params)
    })
  } else {
    // Fall back to manual process
    console.log('Manual signing required for:', functionName)
    console.log('Contract:', contractAddress)
    console.log('Parameters:', params)
  }
}
```

### Phase 3: Full Automation

```typescript
// Deployment script integration
async function deployWithSafeGovernance() {
  const deployment = await deployContract('MyContract', [...args])
  
  // Automatically transfer ownership to Safe
  await executeGovernanceTransaction(
    deployment.address,
    'transferOwnership',
    [process.env.SAFE_ADDRESS],
    true // Enable automation
  )
  
  console.log('Contract deployed and ownership transferred to Safe')
}
```

## Integration with Hardhat Deployment Scripts

```typescript
// deploy/05_configure_with_safe.ts
import { DeployFunction } from 'hardhat-deploy/types'
import Safe from '@safe-global/protocol-kit'

const func: DeployFunction = async function (hre) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deployer } = await getNamedAccounts()

  // Initialize Safe
  const signer = await ethers.getSigner(deployer)
  const protocolKit = await Safe.init({
    provider: signer.provider,
    signer,
    safeAddress: process.env.SAFE_ADDRESS
  })

  // Get deployed contract
  const contract = await deployments.get('MyContract')
  const contractInstance = await ethers.getContractAt('MyContract', contract.address)

  // Create configuration transaction
  const configTransaction = {
    to: contract.address,
    value: '0',
    data: contractInstance.interface.encodeFunctionData('initialize', [
      process.env.PARAM1,
      process.env.PARAM2
    ])
  }

  // Execute through Safe
  const safeTransaction = await protocolKit.createTransaction(configTransaction)
  const signedTransaction = await protocolKit.signTransaction(safeTransaction)
  const result = await protocolKit.executeTransaction(signedTransaction)
  
  console.log('Configuration transaction executed:', result.hash)
}

export default func
func.tags = ['SafeConfig']
```

## Troubleshooting

### Common Issues

1. **Insufficient Signatures**
   - Check threshold requirements: `await protocolKit.getThreshold()`
   - Verify all required signers have signed

2. **Transaction Failures**
   - Use transaction simulation before execution
   - Check Safe balance for gas fees
   - Validate contract state and permissions

3. **Network Connectivity**
   - Ensure RPC endpoint is accessible
   - Configure appropriate gas prices for network

### Debug Helpers

```typescript
async function debugSafeState() {
  console.log('Safe Address:', protocolKit.getAddress())
  console.log('Safe Owners:', await protocolKit.getOwners())
  console.log('Safe Threshold:', await protocolKit.getThreshold())
  console.log('Safe Balance:', await provider.getBalance(protocolKit.getAddress()))
  console.log('Safe Nonce:', await protocolKit.getNonce())
}
```

## Conclusion

The Safe Protocol Kit provides a robust foundation for automating multi-signature governance operations in the dTRINITY protocol. By implementing this SDK, teams can:

- Reduce manual intervention in governance processes
- Improve transaction reliability and auditability  
- Enable programmatic execution of complex multi-step operations
- Maintain security through multi-signature validation

The migration should be gradual, starting with non-critical operations and expanding to full automation as confidence builds in the system.

## Additional Resources

- [Official Safe Protocol Kit Documentation](https://docs.safe.global/sdk/protocol-kit)
- [Safe Transaction Service API](https://docs.safe.global/sdk/api-kit)
- [GitHub Repository](https://github.com/safe-global/safe-core-sdk)
- [Safe Smart Account Contracts](https://github.com/safe-global/safe-smart-account)