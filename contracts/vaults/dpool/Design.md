**Core Concept:**

dPOOL is a collection of individual yield farms, where each vault represents a specific LP position on a specific DEX. Users can choose which farm to participate in based on their risk/reward preferences. Each vault is a pure ERC4626 that accepts LP tokens directly and uses its respective DEX's native pricing for valuation. Periphery contracts handle base asset conversions and DEX interactions with slippage protection.

**Key Benefits:**
- **Farm Selection:** Users choose specific LP exposure based on risk/reward preferences
- **Clean Separation:** Core vault only handles LP token accounting, periphery handles DEX complexity and base asset conversions
- **Risk Isolation:** Each vault represents pure exposure to one specific LP pool
- **Native Pricing:** Each DEX uses its own battle-tested pricing mechanisms without oracle dependencies
- **Multi-DEX Support:** Supports Curve, Uniswap, and other DEX protocols
- **Simple Architecture:** Minimal vault complexity, complex logic isolated in replaceable periphery

**Contracts:**

1. **`DPoolVaultLP.sol` (Base Contract)**
   * **Type:** Abstract Base Asset ERC4626 Vault (Non-Upgradeable)
   * **Inherits:** `ERC4626`, `AccessControl`
   * **Core Logic:** Abstract ERC4626 vault that accepts LP tokens and values them in base asset terms. No DEX interactions, only LP token accounting and valuation.
   * **Key State:**
     * `asset()`: Base asset address for consistent valuation (e.g., USDC). Immutable.
     * `lpToken`: Address of the specific LP token this vault accepts. Immutable.
     * `withdrawalFeeBps`: Fee charged on withdrawal. Settable by `FEE_MANAGER_ROLE`.
     * `maxWithdrawalFeeBps`: Hardcoded maximum for withdrawal fees.
   * **Roles:**
     * `DEFAULT_ADMIN_ROLE`: Can manage other roles.
     * `FEE_MANAGER_ROLE`: Can set withdrawal fees up to maximum.
   * **Key Functions:**
     * `deposit(uint256 lpAmount, address receiver)`: Standard ERC4626 deposit accepting LP tokens directly.
     * `withdraw(uint256 assets, address receiver, address owner)`: Standard ERC4626 withdrawal returning LP tokens equivalent to asset value.
     * `totalAssets()`: Abstract function for LP valuation in base asset terms using DEX-native pricing.
     * `previewDeposit(uint256 lpAmount)`: Preview shares for LP token deposit.
     * `previewWithdraw(uint256 assets)`: Preview LP tokens returned for asset withdrawal.

2. **`DPoolVaultCurveLP.sol` (Curve Implementation)**
   * **Type:** Curve LP Token ERC4626 Vault (Non-Upgradeable)
   * **Inherits:** `DPoolVaultLP`
   * **Core Logic:** Pure LP token vault that accepts Curve LP tokens and values them consistently using a base asset.
   * **Key State:**
     * `asset()`: Base asset for consistent valuation (e.g., USDC). Immutable.
     * `curvePool`: Address of the Curve pool for pricing queries. Immutable.
     * `lpToken`: Address of the Curve LP token that this vault accepts. Immutable.
     * `baseAssetIndex`: Index of base asset in Curve pool for pricing. Immutable.
   * **Implementation:**
     * `deposit(uint256 lpAmount, address receiver)`: Accepts LP tokens directly, mints shares based on LP value.
     * `withdraw(uint256 assets, address receiver, address owner)`: Burns shares, returns LP tokens equivalent to asset value.
     * `totalAssets()`: Uses `curvePool.calc_withdraw_one_coin(lpBalance, baseAssetIndex)` to value LP tokens in base asset terms.

3. **`DPoolCurvePeriphery.sol` (Curve DEX Handler)**
   * **Type:** Curve Pool Asset ↔ LP Token Conversion Handler (Non-Upgradeable, replaceable)
   * **Purpose:** Handles pool asset deposits/withdrawals by converting to/from Curve LP tokens with slippage protection.
   * **Key State:**
     * `vault`: Address of the associated Curve LP vault. Immutable.
     * `curvePool`: Address of the Curve pool. Immutable.
     * `poolAssets`: `address[2]`. The two assets in the Curve pool. Immutable.
     * `whitelistedAssets`: `mapping(address => bool)`. Assets approved for deposits/withdrawals. Managed by admin.
     * `maxSlippageBps`: Maximum allowed slippage. Settable by admin.
   * **Roles:**
     * `DEFAULT_ADMIN_ROLE`: Can manage whitelisted assets and slippage settings.
   * **Key Functions:**
     * `depositAsset(address asset, uint256 amount, address receiver, uint256 minShares, uint256 maxSlippage)`: Converts any whitelisted pool asset to LP, deposits to vault.
     * `withdrawToAsset(uint256 shares, address asset, address receiver, address owner, uint256 minAmount, uint256 maxSlippage)`: Withdraws LP from vault, converts to any whitelisted pool asset.
     * `previewDepositAsset(address asset, uint256 amount)`: Preview shares for pool asset deposit.
     * `previewWithdrawToAsset(uint256 shares, address asset)`: Preview pool asset amount for share withdrawal.
     * `getSupportedAssets()`: Returns the whitelisted pool assets that can be used for deposits/withdrawals.
     * `addWhitelistedAsset(address asset)`: Admin function to whitelist an asset for deposits/withdrawals.
     * `removeWhitelistedAsset(address asset)`: Admin function to remove an asset from whitelist.
     * `isAssetWhitelisted(address asset)`: Check if an asset is whitelisted for use.

4. **`DPoolVaultFactory.sol`**
   * **Type:** Vault Deployment Factory (Non-Upgradeable)
   * **Purpose:** Standardized deployment of vault + periphery pairs across different DEX types.
   * **Key State:**
     * `vaultImplementations`: `mapping(bytes32 => address)`. Maps DEX type to vault implementation.
     * `peripheryImplementations`: `mapping(bytes32 => address)`. Maps DEX type to periphery implementation.
     * `deployedVaults`: `address[]`. List of all deployed vaults.
     * `deployedPeripheries`: `address[]`. List of all deployed peripheries.
   * **Key Functions:**
     * `deployFarm(bytes32 dexType, string memory name, string memory symbol, address lpToken, bytes calldata pricingConfig) returns (address vault, address periphery)`: Generic deployment function for any DEX type.
     * `setVaultImplementation(bytes32 dexType, address implementation)`: Admin function to register vault implementations.
     * `setPeripheryImplementation(bytes32 dexType, address implementation)`: Admin function to register periphery implementations.
     * `getVaultInfo(address vault) returns (VaultInfo memory)`: Returns comprehensive vault information.
     * `getAllVaults() returns (address[] memory)`: Returns list of all deployed vaults.

**User Flow Examples:**

* **Advanced Users (Direct LP):**
  1. User → `DPoolVaultCurveLP.deposit(lpAmount, user)` (standard ERC4626)
  2. Vault → Accept LP tokens directly, mint shares based on `totalAssets()` valuation
  3. Vault → Use Curve's `calc_withdraw_one_coin()` for share pricing

* **Regular Users (Any Pool Asset via Periphery):**
  1. User → `DPoolCurvePeriphery.depositAsset(USDC, 1000, user, minShares, 1%)`
  2. Periphery → Validate USDC is whitelisted, pull 1000 USDC from user, determine asset index (0 for USDC)
  3. Periphery → `curvePool.add_liquidity([1000, 0], minLP)` with slippage protection
  4. Periphery → `vault.deposit(lpAmount, user)` → Vault mints shares based on LP value in base asset terms
  5. Periphery → Return transaction details

* **Flexible Withdrawal:**
  1. User → `DPoolCurvePeriphery.withdrawToAsset(shares, frxUSD, user, user, minAmount, 1%)`
  2. Periphery → Validate frxUSD is whitelisted, calculate LP needed, call `vault.withdraw(assetsEquivalent, periphery, user)` → Get LP tokens
  3. Periphery → `curvePool.remove_liquidity_one_coin(lpAmount, 1, minAmount)` (index 1 for frxUSD)
  4. Periphery → Send frxUSD to user (user deposited USDC but withdrew frxUSD!)
  5. Note: Vault internally valued LP in base asset terms for consistent share pricing

**Deployment Pattern:**

```solidity
// First, register implementations for different DEX types
factory.setVaultImplementation(keccak256("CURVE"), curveLPVaultImplementation);
factory.setPeripheryImplementation(keccak256("CURVE"), curvePeripheryImplementation);

// Deploy farms using generic function
(address dpCurveUSDC_frxUSD_Vault, address dpCurveUSDC_frxUSD_Periphery) = factory.deployFarm(
    keccak256("CURVE"), // dexType
    "dPOOL USDC/frxUSD Curve",
    "USDC-frxUSD_Curve",
    curveUSDC_frxUSD_LP_Token, // The actual LP token address
    abi.encode(curvePool, USDC_ADDRESS, 0) // Curve config: pool, base asset, base asset index
);

// Setup asset whitelist for periphery
DPoolCurvePeriphery periphery = DPoolCurvePeriphery(dpCurveUSDC_frxUSD_Periphery);
periphery.addWhitelistedAsset(USDC_ADDRESS);   // Allow USDC deposits/withdrawals
periphery.addWhitelistedAsset(frxUSD_ADDRESS); // Allow frxUSD deposits/withdrawals

// Deploy different DEX type with same function
factory.setVaultImplementation(keccak256("UNISWAP_V3"), uniswapV3VaultImplementation);
factory.setPeripheryImplementation(keccak256("UNISWAP_V3"), uniswapV3PeripheryImplementation);

(address dpUniV3USDC_USDT_Vault, address dpUniV3USDT_Periphery) = factory.deployFarm(
    keccak256("UNISWAP_V3"), // dexType
    "dPOOL USDC/USDT Uniswap V3",
    "USDC-USDT_UniV3",
    uniswapV3Position_TokenId, // The position NFT or wrapped token
    abi.encode(uniswapPool, positionManager, tickLower, tickUpper) // Uniswap-specific pricing config
);

// Users can only deposit/withdraw whitelisted assets:
periphery.depositAsset(USDC, 1000e6, user, minShares, 1%);    // ✅ Allowed (whitelisted)
periphery.depositAsset(frxUSD, 1000e18, user, minShares, 1%); // ✅ Allowed (whitelisted)
periphery.depositAsset(DAI, 1000e18, user, minShares, 1%);    // ❌ Reverts (not whitelisted)
// But vault values everything in base asset (USDC) for consistent share pricing
```

**File Structure:**
```
contracts/vaults/dpool/
├── core/
│   ├── DPoolVaultLP.sol              // Abstract base asset vault
│   ├── DPoolVaultCurveLP.sol         // Curve LP vault implementation
│   ├── DPoolVaultUniswapV3LP.sol     // Uniswap V3 LP position vault
│   ├── DPoolVaultFactory.sol         // Multi-DEX deployment factory
│   └── interfaces/IDPoolVaultLP.sol
└── periphery/
    ├── DPoolCurvePeriphery.sol       // Curve pool asset conversion
    ├── DPoolUniswapV3Periphery.sol   // Uniswap V3 pool asset conversion
    └── interfaces/IDPoolPeriphery.sol
```

**Key Design Decisions Summary:**

* **Base Asset Vaults:** Core vaults accept LP tokens but value them in base asset terms for consistent ERC4626 accounting.
* **DEX-Native Pricing:** Each vault uses its DEX's native pricing for `totalAssets()` calculation in base asset terms.
* **Periphery Pattern:** All pool asset conversions and DEX interactions isolated in periphery contracts.
* **Asset Whitelisting:** Periphery contracts restrict deposits/withdrawals to approved assets for security and control.
* **Dual Interface:** Advanced users can use vaults directly (LP tokens), regular users use periphery (whitelisted pool assets).
* **Clean Separation:** Vault handles base asset accounting, periphery handles conversions with slippage protection.
* **Generic Factory:** Single deployment function supports all DEX types via implementation registry and flexible config parameters.
* **No Oracle Dependencies:** Each DEX uses its own pricing mechanisms.
* **Replaceable Periphery:** Periphery contracts can be upgraded without touching core vaults.
* **Farm Collection Model:** Users choose specific LP exposures across different DEXes.
