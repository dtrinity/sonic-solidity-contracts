# Pendle PT + Odos Liquidator Bot

This directory contains the liquidator bot implementation for handling Pendle PT (Principal Token) liquidations with two-stage swaps: PT → underlying asset → target token.

## Architecture Overview

The PT+Odos bot follows a two-stage swap architecture:

1. **Stage 1**: PT token → underlying asset (via Pendle SDK/Router)
2. **Stage 2**: underlying asset → target token (via Odos API/Router)

This enables efficient liquidation of positions with PT token collateral by first converting PT tokens to their underlying assets, then swapping those assets to the required debt token for repayment.

## Files Overview

### Core Files

- **`core.ts`** - Main bot logic and liquidation execution
- **`quote.ts`** - Two-stage quote generation using Pendle SDK + Odos API
- **`run.ts`** - Entry point for continuous bot operation
- **`liquidate_specific_users.ts`** - Script for testing specific user liquidations

### Key Features

- ✅ **PT Token Detection** - Automatic detection via `expiry()` method
- ✅ **Two-Stage Quotes** - Coordinated Pendle + Odos pricing
- ✅ **SDK Integration** - Uses Pendle hosted SDK for optimal execution
- ✅ **Slippage Protection** - Built-in tolerance for both stages
- ✅ **Flash Loan/Mint Support** - Compatible with both capital sources
- ✅ **Error Handling** - Comprehensive error logging and recovery

## Usage

### Running the Continuous Bot

```bash
# Run the PT liquidator bot continuously
yarn hardhat run --network sonic_mainnet typescript/pendle_odos_bot/run.ts
```

### Liquidating Specific Users

```bash
# Set environment variable for target users
export USER_ADDRESSES="0x123...,0x456...,0x789..."

# Run targeted liquidation
yarn hardhat run --network sonic_mainnet typescript/pendle_odos_bot/liquidate_specific_users.ts
```

### Testing PT Token Detection

```bash
# Test if a token is a PT token
yarn hardhat console --network sonic_mainnet

# In console:
const contract = await ethers.getContractAt("FlashMintLiquidatorAaveBorrowRepayPTOdos", "CONTRACT_ADDRESS");
const isPT = await contract.isPTToken("TOKEN_ADDRESS");
console.log("Is PT Token:", isPT);
```

## Configuration

The PT bot uses the same configuration as the regular Odos bot (`config.liquidatorBotOdos`):

```typescript
liquidatorBotOdos: {
  odosApiUrl: string,              // Odos API endpoint
  odosRouter: string,              // Odos router contract address
  slippageTolerance: number,       // Slippage tolerance in basis points
  healthFactorThreshold: number,   // Health factor threshold for liquidation
  profitableThresholdInUSD: number, // Minimum profit threshold
  liquidatingBatchSize: number,    // Batch size for processing users
  healthFactorBatchSize: number,   // Batch size for health factor checks
  reserveBatchSize: number,        // Batch size for reserve processing
  flashMinters: {                  // Flash minter addresses by symbol
    [symbol: string]: string
  },
  isUnstakeTokens: {              // Tokens that need unstaking
    [address: string]: boolean
  }
}
```

## PT Token Detection Logic

The bot uses a simple but effective PT token detection method:

```typescript
async function checkIfPTToken(tokenAddress: string): Promise<boolean> {
  try {
    // PT tokens have an expiry() method
    const contract = await ethers.getContractAt(
      ["function expiry() external view returns (uint256)"],
      tokenAddress,
    );
    
    await contract.expiry(); // This will revert if not a PT token
    return true;
  } catch {
    return false; // Not a PT token
  }
}
```

## Two-Stage Quote Generation

### Stage 1: PT → Underlying (Pendle SDK)

```typescript
// Call Pendle SDK for PT swap data
const pendleResponse = await callSDK<RedeemPyData>(`v2/sdk/${chainId}/redeem`, {
  receiver: liquidatorAccountAddress,
  slippage: 0.005,                // 0.5% slippage
  yt: ptTokenAddress,             // PT token to redeem
  amountIn: formattedPTAmount,    // Amount of PT to swap
  tokenOut: underlyingAsset,      // Want underlying asset
});
```

### Stage 2: Underlying → Target (Odos API)

```typescript
// Use Pendle output as Odos input
const odosQuoteRequest = {
  chainId: chainId,
  inputTokens: [{
    tokenAddress: underlyingAsset,
    amount: pendleData.data.amountOut, // Exact output from Pendle
  }],
  outputTokens: [{ tokenAddress: borrowTokenAddress, proportion: 1 }],
  userAddr: liquidatorAccountAddress,
  slippageLimitPercent: slippageBuffer,
};
```

## Contract Integration

The bot creates `PTSwapData` structures that match the contract interface:

```typescript
interface PTSwapData {
  underlyingAsset: string;      // Underlying asset from PT swap
  expectedUnderlying: string;   // Expected underlying amount from Pendle SDK  
  pendleTarget: string;         // Target contract for Pendle transaction
  pendleCalldata: string;       // Transaction data from Pendle SDK
  odosTarget: string;           // Target contract for Odos transaction
  odosCalldata: string;         // Transaction data from Odos API
}
```

This data is ABI-encoded and passed to the liquidation contracts:

```typescript
const encodedSwapData = ethers.AbiCoder.defaultAbiCoder().encode(
  ["tuple(address,uint256,address,bytes,address,bytes)"],
  [[
    ptSwapData.underlyingAsset,
    ptSwapData.expectedUnderlying,
    ptSwapData.pendleTarget,
    ptSwapData.pendleCalldata,
    ptSwapData.odosTarget || ethers.ZeroAddress,
    ptSwapData.odosCalldata || "0x",
  ]]
);
```

## Error Handling & Monitoring

### Common Error Scenarios

1. **Non-PT Tokens**: Automatically skipped with appropriate logging
2. **Pendle SDK Failures**: Detailed error reporting and fallback logic
3. **Odos Quote Failures**: Slippage adjustment and retry mechanisms
4. **Liquidation Failures**: Comprehensive error logging for debugging

### Slack Notifications

The bot sends Slack notifications for:
- ✅ **Successful PT Liquidations** with profit details
- ❌ **Failed Liquidations** with error context and debugging info
- 📊 **Health Factor Monitoring** for PT token positions

### State Management

User states are saved with detailed step tracking:
- `checking_pt_token` - PT token detection phase
- `getting_pendle_quote` - Pendle SDK quote generation
- `getting_odos_quote` - Odos API quote generation
- `profitable_pt_user_performing_liquidation` - Execution phase
- `successful_pt_liquidation` - Completion

## Performance Optimization

### Batch Processing
- Health factor checks are batched for efficiency
- PT token detection is cached per user session
- Quote generation is parallelized where possible

### Slippage Management
- **PT Swaps**: 0.5% default slippage via Pendle SDK
- **Odos Swaps**: 1% default slippage via Odos API  
- **Combined Buffer**: Additional 10% buffer for PT price impact

### Gas Optimization
- Uses flash loans for lower gas when possible
- Minimizes intermediate approvals and transfers
- Batches multiple liquidations when profitable

## Development & Testing

### Local Testing

```bash
# Test PT token detection
yarn hardhat test test/pendle/PendleSwapPOC.ts

# Test liquidation contracts
yarn hardhat test test/pendle_odos/

# Run full integration test
yarn hardhat run typescript/pendle_odos_bot/liquidate_specific_users.ts --network localhost
```

### Debugging

Enable debug logging by setting:
```bash
export DEBUG=true
export VERBOSE_LOGGING=true
```

### Monitoring

Monitor bot performance via:
- Slack notifications for real-time updates
- State files in `./state/${network}/pt-user-states/`
- Console logs with detailed step tracking
- Transaction hash tracking for successful liquidations

## Security Considerations

### Slippage Protection
- Multi-stage slippage tolerance (Pendle + Odos)
- Conservative estimation buffers
- Output amount verification

### Access Control
- Inherits security model from base contracts
- No additional privileged operations
- Standard liquidation access controls

### Oracle Dependencies
- Relies on Pendle SDK for PT pricing
- Uses Odos API for underlying asset routing
- Falls back to Aave price oracles for validation

## Deployment Dependencies

Before running the PT bot, ensure:
1. ✅ PT liquidation contracts are deployed
2. ✅ Pendle SDK is accessible (internet connection required)
3. ✅ Odos API is accessible (API key configured if needed)
4. ✅ Flash mint/loan contracts are properly configured
5. ✅ Slack notifications are set up (optional but recommended)

## Support

For issues or questions:
1. Check the design document for architectural details
2. Review contract test files for usage examples  
3. Monitor Slack notifications for real-time error reporting
4. Examine state files for detailed execution tracking
5. Test on testnet before mainnet deployment 