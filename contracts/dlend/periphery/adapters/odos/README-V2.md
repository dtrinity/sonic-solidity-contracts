# Odos Adapters V2 - PT Token Support

This directory contains the V2 adapters that extend the original Odos adapters with support for Pendle PT (Principal Token) swaps. The V2 adapters can handle both regular ERC20 token swaps and composed PT token swaps.

## Overview

The V2 adapters automatically detect when PT tokens are involved in swaps and execute the appropriate swap strategy:

1. **Regular Swaps**: When neither input nor output is a PT token, performs standard Odos swaps
2. **Composed Swaps**: When either input or output is a PT token, performs a two-stage swap:
   - PT → underlying → target token (via Pendle → Odos)
   - target → underlying → PT token (via Odos → Pendle)

## Architecture

### Base Classes

- **`BaseOdosSwapAdapterV2`**: Core functionality with PT detection and dual swap logic
- **`BaseOdosBuyAdapterV2`**: Extends base for exact output swaps (buy operations)
- **`BaseOdosSellAdapterV2`**: Extends base for exact input swaps (sell operations)

### Concrete Adapters

- **`OdosRepayAdapterV2`**: Repay debts using collateral with PT support
- **`OdosLiquiditySwapAdapterV2`**: Swap collateral assets with PT support
- Additional adapters can be created following the same pattern

### Interfaces

- **`IBaseOdosAdapterV2`**: Enhanced interface with PT-specific events and errors

## Data Structures

### PTSwapDataV2

```solidity
struct PTSwapDataV2 {
    bool isComposed;           // True for PT swaps, false for regular swaps
    address underlyingAsset;   // Underlying asset for PT tokens
    bytes pendleCalldata;      // Pendle SDK-generated transaction data
    bytes odosCalldata;        // Odos API-generated transaction data
}
```

## Usage Examples

### 1. Regular Token Swap

For regular ERC20 → ERC20 swaps, use the adapters as before:

```solidity
// Create regular swap data (no PT tokens involved)
bytes memory odosCalldata = getOdosSwapData(tokenA, tokenB, amount);
PTSwapDataV2 memory swapData = PTSwapDataV2({
    isComposed: false,
    underlyingAsset: address(0),
    pendleCalldata: "",
    odosCalldata: odosCalldata
});

// Execute swap
repayAdapter.swapAndRepay(
    RepayParamsV2({
        collateralAsset: tokenA,
        debtAsset: tokenB,
        swapData: abi.encode(swapData),
        // ... other params
    }),
    permitInput
);
```

### 2. PT Token to Regular Token

For PT → ERC20 swaps:

```solidity
// Create composed swap data for PT → Regular token
PTSwapDataV2 memory swapData = PTSwapDataV2({
    isComposed: true,
    underlyingAsset: underlyingAsset,  // USDC (underlying of ptUSDC)
    pendleCalldata: pendleCalldata,    // From Pendle SDK
    odosCalldata: odosCalldata         // From Odos API (USDC → targetToken)
});

// Execute swap
repayAdapter.swapAndRepay(
    RepayParamsV2({
        collateralAsset: ptUSDC,
        debtAsset: targetToken,
        swapData: abi.encode(swapData),
        // ... other params
    }),
    permitInput
);
```

### 3. Regular Token to PT Token

For ERC20 → PT swaps:

```solidity
// Create composed swap data for Regular → PT token
PTSwapDataV2 memory swapData = PTSwapDataV2({
    isComposed: true,
    underlyingAsset: underlyingAsset,  // USDC (underlying of ptUSDC)
    pendleCalldata: pendleCalldata,    // From Pendle SDK (USDC → ptUSDC)
    odosCalldata: odosCalldata         // From Odos API (sourceToken → USDC)
});

// Execute swap
liquidityAdapter.swapLiquidity(
    LiquiditySwapParamsV2({
        collateralAsset: sourceToken,
        newCollateralAsset: ptUSDC,
        swapData: abi.encode(swapData),
        // ... other params
    }),
    permitInput
);
```

### 4. PT Token to PT Token

For PT → PT direct swaps (no Odos involved):

```solidity
// Create swap data for PT → PT (only Pendle, no Odos)
PTSwapDataV2 memory swapData = PTSwapDataV2({
    isComposed: true,
    underlyingAsset: address(0),       // Not needed for PT → PT
    pendleCalldata: pendleCalldata,    // From Pendle SDK (ptUSDC → ptETH)
    odosCalldata: ""                   // Not needed for PT → PT
});

// Execute swap
repayAdapter.swapAndRepay(
    RepayParamsV2({
        collateralAsset: ptUSDC,      // Input PT token
        debtAsset: ptETH,             // Output PT token
        swapData: abi.encode(swapData),
        // ... other params
    }),
    permitInput
);
```

## PT Token Detection

The adapters automatically detect PT tokens by checking for the `SY()` method:

```solidity
function isPTToken(address token) public view returns (bool) {
    try this.checkPTInterface(token) returns (bool result) {
        return result;
    } catch {
        return false;
    }
}
```

## Swap Strategies

The V2 adapters automatically detect the appropriate swap strategy using `PTSwapUtils.determineSwapType()` which returns an enum value from `ISwapTypes.SwapType`:

### Swap Type Enumeration

```solidity
enum SwapType {
    REGULAR_SWAP,     // 0: Regular ERC20 → ERC20 (Odos only)
    PT_TO_REGULAR,    // 1: PT → underlying → ERC20 (Pendle + Odos)
    REGULAR_TO_PT,    // 2: ERC20 → underlying → PT (Odos + Pendle)
    PT_TO_PT          // 3: PT → PT (Pendle only)
}
```

## Swap Flow

### PT → Regular Token Flow (PT_TO_REGULAR)

1. **Detection**: Adapter detects input is PT token
2. **Stage 1**: Execute Pendle swap: PT → underlying asset
3. **Stage 2**: Execute Odos swap: underlying → target token
4. **Validation**: Ensure minimum output requirements are met

### Regular → PT Token Flow (REGULAR_TO_PT)

1. **Detection**: Adapter detects output is PT token
2. **Stage 1**: Execute Odos swap: input → underlying asset
3. **Stage 2**: Execute Pendle swap: underlying → PT token
4. **Validation**: Ensure minimum output requirements are met

### PT → PT Token Flow (PT_TO_PT)

1. **Detection**: Adapter detects both input and output are PT tokens
2. **Direct Swap**: Execute single Pendle swap: PT input → PT output
3. **No Odos**: No underlying asset conversion needed
4. **Validation**: Ensure minimum output requirements are met

### Regular Token Flow (REGULAR_SWAP)

1. **Detection**: Adapter detects neither input nor output is PT token
2. **Direct Swap**: Execute single Odos swap: ERC20 → ERC20
3. **No Pendle**: No PT token conversion needed
4. **Validation**: Ensure minimum output requirements are met

## Off-chain Integration

### Pendle SDK Integration

```typescript
import { PendleSDK } from '@pendle/sdk';

// Get Pendle swap data
const pendleSwap = await pendleSDK.swapPTForUnderlying({
    ptToken: 'PT_TOKEN_ADDRESS',
    amountIn: 'AMOUNT',
    slippage: 0.5
});

const pendleCalldata = pendleSwap.data;
// Note: Pendle router is predefined in the adapter contracts
```

### Odos API Integration

```typescript
// Get Odos swap data
const odosQuote = await fetch('https://api.odos.xyz/sor/quote/v2', {
    method: 'POST',
    body: JSON.stringify({
        chainId: 1,
        inputTokens: [{
            tokenAddress: 'INPUT_TOKEN',
            amount: 'AMOUNT'
        }],
        outputTokens: [{
            tokenAddress: 'OUTPUT_TOKEN',
            proportion: 1
        }],
        // ... other params
    })
});

const odosCalldata = odosQuote.data.transaction.data;
```

## Events

The V2 adapters emit additional events for tracking:

```solidity
event PTSwapExecuted(
    address indexed ptToken,
    address indexed underlyingToken,
    uint256 ptAmount,
    uint256 underlyingReceived
);

event ComposedSwapExecuted(
    address indexed inputToken,
    address indexed outputToken,
    uint256 inputAmount,
    uint256 finalOutputAmount
);
```

## Error Handling

New error types for PT operations:

```solidity
error InvalidPTSwapData();
error PendleSwapFailed(string reason);
error OdosSwapFailed(string reason);
error InsufficientOutputAfterComposedSwap(uint256 expected, uint256 actual);
```

## Migration from V1

1. **Update imports**: Change to V2 adapter contracts
2. **Update data structures**: Use `PTSwapDataV2` instead of raw bytes
3. **Handle PT detection**: The adapters automatically handle PT vs regular swaps
4. **Update off-chain logic**: Generate both Pendle and Odos swap data when PT tokens are involved

## Best Practices

1. **Always validate swap data**: Ensure `PTSwapDataV2` struct is properly formed before executing
2. **Handle slippage**: Account for two-stage swap slippage in PT operations
3. **Gas estimation**: PT swaps require more gas due to two-stage operations
4. **Error handling**: Implement proper error handling for both Pendle and Odos failures

## Security Considerations

1. **Predefined routers**: V2 adapters use predefined Pendle router addresses instead of client-provided addresses to prevent potential attacks
2. **Swap data validation**: Always validate off-chain generated swap data
3. **Slippage protection**: Implement appropriate slippage protection for composed swaps
4. **Access controls**: Ensure proper access controls on adapter functions
5. **Reentrancy protection**: V2 adapters include reentrancy guards where needed
