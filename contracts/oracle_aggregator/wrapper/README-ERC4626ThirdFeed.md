# ERC4626RateProviderThirdFeedWrapperWithThresholding

A three-feed oracle wrapper that composes an ERC4626 vault conversion with a rate provider and a third price feed, with optional thresholding on each leg.

## Overview

This contract extends the existing two-feed pattern to support three-leg price composition:

1. **ERC4626 Vault**: Converts shares to assets (e.g., wstkscUSD → stkscUSD)
2. **Rate Provider**: Converts assets to intermediate currency (e.g., stkscUSD → scUSD)
3. **Third Feed**: Converts intermediate currency to base currency (e.g., scUSD → USD)

## Use Case

For a token like `wstkscUSD` that needs to be priced in `USD`:

```
wstkscUSD → stkscUSD → scUSD → USD
    ↓           ↓         ↓
 ERC4626   RateProvider  Chainlink
  Vault      (Custom)    Feed
```

## Architecture

### Three-Leg Composition

The final price is calculated as:
```
price = (ERC4626_rate * RateProvider_rate * ThirdFeed_rate) / (BASE_CURRENCY_UNIT * BASE_CURRENCY_UNIT)
```

### Thresholding

Each leg can have optional thresholding:
- **Primary Threshold**: Applied to ERC4626 leg
- **Secondary Threshold**: Applied to rate provider leg  
- **Tertiary Threshold**: Applied to third feed leg

Thresholding works as:
- If `price > lowerThresholdInBase`, use `fixedPriceInBase`
- Otherwise, use the original price

## Contract Interface

### Key Functions

```solidity
function setFeed(
    address asset,
    address erc4626Vault,
    address rateProvider,
    address thirdFeed,
    uint256 lowerThresholdInBase1,
    uint256 fixedPriceInBase1,
    uint256 lowerThresholdInBase2,
    uint256 fixedPriceInBase2,
    uint256 lowerThresholdInBase3,
    uint256 fixedPriceInBase3
) external onlyRole(ORACLE_MANAGER_ROLE)
```

### Configuration Structure

```solidity
struct ThreeFeedConfig {
    address erc4626Vault;           // ERC4626 vault (shares token)
    address rateProvider;           // IRateProvider (assets -> intermediate)
    address thirdFeed;              // IPriceFeed (intermediate -> base)
    uint256 rateProviderUnit;       // Calculated from asset decimals
    uint256 thirdFeedUnit;          // Calculated from third feed decimals
    ThresholdConfig primaryThreshold;    // ERC4626 leg thresholding
    ThresholdConfig secondaryThreshold;  // Rate provider leg thresholding
    ThresholdConfig tertiaryThreshold;   // Third feed leg thresholding
}
```

## Deployment Example

```typescript
// Deploy the wrapper
const wrapper = await ERC4626ThirdFeedWrapper.deploy(
  ethers.ZeroAddress,  // baseCurrency (0x0 for USD)
  ethers.parseUnits("1", 8)  // baseCurrencyUnit (1e8)
);

// Configure a feed
await wrapper.setFeed(
  wstkscUSDAddress,        // asset
  erc4626VaultAddress,     // ERC4626 vault
  rateProviderAddress,     // rate provider
  chainlinkFeedAddress,    // third feed
  0, 0,                    // primary threshold (disabled)
  0, 0,                    // secondary threshold (disabled)
  0, 0                     // tertiary threshold (disabled)
);
```

## Security Features

1. **Access Control**: Only `ORACLE_MANAGER_ROLE` can manage feeds
2. **Input Validation**: All feed addresses and units are validated
3. **Overflow Protection**: Uses `Math.mulDiv` for all multiplications
4. **Liveness Checks**: Detects stale feeds and zero prices
5. **Thresholding**: Optional price protection on each leg

## Liveness Detection

The contract considers a feed alive when:
- All three legs return prices > 0
- Third feed is not stale (based on configurable timeout)
- Rate provider returns valid rate > 0

### Configurable Stale Timeout

The stale timeout for third feed liveness checks is configurable:

```solidity
function setStaleTimeout(uint256 newTimeoutSeconds) external onlyRole(ORACLE_MANAGER_ROLE)
```

**Features:**
- **Default**: 1 hour (3600 seconds)
- **Configurable**: Can be set to any value from 0 to 30 days
- **Disable**: Set to 0 to disable stale checks entirely
- **Maximum**: 30 days (2,592,000 seconds) to prevent unreasonable values
- **Access Control**: Only `ORACLE_MANAGER_ROLE` can update

**Examples:**
```typescript
// Set to 1 day
await wrapper.setStaleTimeout(24 * 3600);

// Set to 1 week  
await wrapper.setStaleTimeout(7 * 24 * 3600);

// Disable stale checks
await wrapper.setStaleTimeout(0);
```

## Gas Optimization

- Units are calculated and stored during setup to avoid repeated calculations
- Functions are split to avoid "stack too deep" errors
- Uses storage references to minimize local variables

## Testing

Comprehensive test suite covers:
- Three-leg price composition
- Thresholding on each leg
- Feed management (add/remove/update)
- Access control
- Liveness detection with configurable stale timeout
- Stale timeout management
- Edge cases and error conditions

Run tests with:
```bash
yarn hardhat test test/oracle_aggregator/ERC4626RateProviderThirdFeedWrapperWithThresholding.test.ts
```

## Integration

The contract implements the standard `IOracleWrapper` interface, making it compatible with existing oracle aggregator systems.

## Example Use Cases

1. **Wrapped Staked Tokens**: wstkscUSD → stkscUSD → scUSD → USD
2. **Liquid Staking Derivatives**: wstETH → stETH → ETH → USD
3. **Yield-Bearing Tokens**: aUSDC → USDC → USD (with custom rate logic)
4. **Cross-Chain Assets**: wBTC → BTC → USD (with bridge rate provider)

## Migration from Two-Feed

To migrate from the existing two-feed wrapper:

1. Deploy the new three-feed wrapper
2. Set up the third feed (intermediate → base currency)
3. Update feed configurations to include the third feed
4. Test thoroughly before switching over
5. Update oracle aggregator configurations

## Best Practices

1. **Feed Selection**: Choose reliable, well-maintained feeds for each leg
2. **Thresholding**: Set appropriate thresholds based on expected price ranges
3. **Monitoring**: Monitor all three feeds for staleness and accuracy
4. **Testing**: Test with various price scenarios and edge cases
5. **Documentation**: Document the specific use case and feed sources
