**Core Concept:**

dPOOL is a collection of individual yield farms, where each vault represents a specific LP position on a specific DEX. Users can choose which farm to participate in based on their risk/reward preferences. Each vault is a pure ERC4626 that accepts LP tokens directly and uses its respective DEX's native pricing for valuation. Periphery contracts handle base asset conversions and DEX interactions with slippage protection.

**Key Benefits:**
- **Farm Selection:** Users choose specific LP exposure based on risk/reward preferences
- **Clean Separation:** Core vault only handles LP token accounting, periphery handles DEX complexity and base asset conversions
- **Risk Isolation:** Each vault represents pure exposure to one specific LP pool
- **Native Pricing:** Each DEX uses its own battle-tested pricing mechanisms without oracle dependencies
- **Multi-DEX Support:** Supports Curve, Uniswap, and other DEX protocols
- **Simple Architecture:** Direct deployment pattern with minimal complexity
- **No Factory Overhead:** Direct contract deployment for simplicity and clarity

**Contracts:**

1. **`DPoolVaultLP.sol` (Base Contract)**
   * **Type:** Abstract Base Asset ERC4626 Vault (Non-Upgradeable)
   * **Inherits:** `ERC4626`, `AccessControl`, `ReentrancyGuard`
   * **Core Logic:** Abstract ERC4626 vault that accepts LP tokens and values them in base asset terms. No DEX interactions, only LP token accounting and valuation.
   * **Key State:**
     * `asset()`: Base asset address for consistent valuation (e.g., USDC). Immutable.
     * `LP_TOKEN`: Address of the specific LP token this vault accepts. Immutable.
     * `withdrawalFeeBps`: Fee charged on withdrawal. Settable by `FEE_MANAGER_ROLE`.
     * `MAX_WITHDRAWAL_FEE_BPS`: Hardcoded maximum for withdrawal fees (5%).
   * **Roles:**
     * `DEFAULT_ADMIN_ROLE`: Can manage other roles.
     * `FEE_MANAGER_ROLE`: Can set withdrawal fees up to maximum.
   * **Key Functions:**
     * `deposit(uint256 lpAmount, address receiver)`: Standard ERC4626 deposit accepting LP tokens directly.
     * `withdraw(uint256 assets, address receiver, address owner)`: Standard ERC4626 withdrawal returning LP tokens equivalent to asset value.
     * `totalAssets()`: Abstract function for LP valuation in base asset terms using DEX-native pricing.
     * `previewDepositLP(uint256 lpAmount)`: Preview shares for LP token deposit.
     * `previewWithdrawLP(uint256 assets)`: Preview LP tokens returned for asset withdrawal.
     * `previewLPValue(uint256 lpAmount)`: Preview base asset value for LP tokens.

2. **`DPoolVaultCurveLP.sol` (Curve Implementation)**
   * **Type:** Curve LP Token ERC4626 Vault (Non-Upgradeable)
   * **Inherits:** `DPoolVaultLP`
   * **Core Logic:** Pure LP token vault that accepts Curve LP tokens and values them consistently using a base asset.
   * **Key State:**
     * `asset()`: Base asset for consistent valuation (e.g., USDC). Immutable.
     * `POOL`: Address of the Curve pool for pricing queries. Immutable.
     * `LP_TOKEN`: Address of the Curve LP token that this vault accepts. Immutable.
     * `BASE_ASSET_INDEX`: Index of base asset in Curve pool for pricing. Immutable (auto-determined).
   * **Implementation:**
     * `deposit(uint256 lpAmount, address receiver)`: Accepts LP tokens directly, mints shares based on LP value.
     * `withdraw(uint256 assets, address receiver, address owner)`: Burns shares, returns LP tokens equivalent to asset value.
     * `totalAssets()`: Uses `curvePool.calc_withdraw_one_coin(lpBalance, BASE_ASSET_INDEX)` to value LP tokens in base asset terms.
     * `pool()`: Returns the Curve pool address.
     * `baseAssetIndex()`: Returns the index of the base asset in the pool.

3. **`DPoolCurvePeriphery.sol` (Curve DEX Handler)**
   * **Type:** Curve Pool Asset ↔ LP Token Conversion Handler (Non-Upgradeable)
   * **Purpose:** Handles pool asset deposits/withdrawals by converting to/from Curve LP tokens with slippage protection.
   * **Key State:**
     * `VAULT`: Address of the associated Curve LP vault. Immutable.
     * `POOL`: Address of the Curve pool. Immutable.
     * `poolAssets`: `address[2]`. The two assets in the Curve pool. Auto-queried from pool.
     * `whitelistedAssets`: `mapping(address => bool)`. Assets approved for deposits/withdrawals. Managed by admin.
     * `supportedAssets`: `address[]`. Array of whitelisted assets for enumeration.
     * `maxSlippageBps`: Maximum allowed slippage. Settable by admin.
   * **Constants:**
     * `MAX_SLIPPAGE_BPS`: Maximum allowed slippage (10%).
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
     * `setMaxSlippage(uint256 newMaxSlippage)`: Admin function to set maximum allowed slippage.

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
  2. Periphery → Validate frxUSD is whitelisted, calculate LP needed, call `vault.redeem(shares, periphery, user)` → Get LP tokens
  3. Periphery → `curvePool.remove_liquidity_one_coin(lpAmount, 1, minAmount)` (index 1 for frxUSD)
  4. Periphery → Send frxUSD to user (user deposited USDC but withdrew frxUSD!)
  5. Note: Vault internally valued LP in base asset terms for consistent share pricing

**Deployment Pattern:**

```typescript
// Direct deployment approach (no factory)
// Example from deployment scripts:

// Deploy Vault directly for each pool
const vault = await deploy(`DPoolVault_USDC_USDS_Curve`, {
  contract: "DPoolVaultCurveLP",
  args: [
    USDC_ADDRESS,           // baseAsset
    curveUSDC_USDS_LP,     // lpToken (curve pool serves as LP token)
    curveUSDC_USDS_Pool,   // pool (same as LP token for Curve)
    "dPOOL USDC/USDS",     // name
    "USDC-USDS_Curve",     // symbol
    admin                   // admin
  ]
});

// Deploy Periphery directly for each pool
const periphery = await deploy(`DPoolPeriphery_USDC_USDS_Curve`, {
  contract: "DPoolCurvePeriphery",
  args: [
    vault.address,         // vault
    curveUSDC_USDS_Pool,  // pool
    admin                  // admin
  ]
});

// Configure periphery - whitelist assets
const peripheryContract = await ethers.getContractAt("DPoolCurvePeriphery", periphery.address);
await peripheryContract.addWhitelistedAsset(USDC_ADDRESS);   // Allow USDC deposits/withdrawals
await peripheryContract.addWhitelistedAsset(USDS_ADDRESS);   // Allow USDS deposits/withdrawals
await peripheryContract.setMaxSlippage(100); // 1% max slippage

// Deploy additional pools
const frxUSDVault = await deploy(`DPoolVault_frxUSD_USDC_Curve`, {
  contract: "DPoolVaultCurveLP",
  args: [frxUSD_ADDRESS, curvefrxUSD_USDC_LP, curvefrxUSD_USDC_Pool, "dPOOL frxUSD/USDC", "frxUSD-USDC_Curve", admin]
});

const frxUSDPeriphery = await deploy(`DPoolPeriphery_frxUSD_USDC_Curve`, {
  contract: "DPoolCurvePeriphery", 
  args: [frxUSDVault.address, curvefrxUSD_USDC_Pool, admin]
});

// Users can interact with any deployed vault:
// Direct LP deposit to USDC/USDS vault
vault.deposit(lpAmount, user);

// Asset conversion through periphery
periphery.depositAsset(USDC, 1000e6, user, minShares, 100);    // ✅ Allowed (whitelisted)
periphery.depositAsset(USDS, 1000e18, user, minShares, 100);   // ✅ Allowed (whitelisted) 
periphery.depositAsset(DAI, 1000e18, user, minShares, 100);    // ❌ Reverts (not whitelisted)
```

**Configuration Structure:**

```typescript
// localhost.ts configuration example
dPool: {
  // eslint-disable-next-line camelcase
  USDC_USDS_Curve: {
    baseAsset: "USDC",                    // Base asset for valuation
    name: "dPOOL USDC/USDS",             // Vault name
    symbol: "USDC-USDS_Curve",           // Vault symbol
    initialAdmin: user1,                  // Initial admin
    initialSlippageBps: 100,             // 1% max slippage for periphery
    pool: "USDC_USDS_CurvePool",         // Pool deployment name (localhost) or address (mainnet)
  },
  // eslint-disable-next-line camelcase 
  frxUSD_USDC_Curve: {
    baseAsset: "frxUSD",                 // Different base asset
    name: "dPOOL frxUSD/USDC", 
    symbol: "frxUSD-USDC_Curve",
    initialAdmin: user1,
    initialSlippageBps: 100,
    pool: "frxUSD_USDC_CurvePool",
  },
}
```

**Deployment Scripts:**

1. **`01_deploy_vaults_and_peripheries.ts`**
   - Deploys vault and periphery contracts directly for each dPool configuration
   - Dependencies: `["curve"]` (requires curve pools to be deployed first)
   - Tags: `["dpool", "dpool-vaults", "dpool-peripheries"]`

2. **`02_configure_periphery.ts`**
   - Configures periphery contracts (whitelist assets, set slippage limits)
   - Dependencies: `["dpool-vaults", "dpool-peripheries"]`
   - Tags: `["dpool", "dpool-periphery-config"]`

3. **`03_verify_system.ts`**
   - Health check and system verification with deployment summary
   - Dependencies: `["dpool-periphery-config"]`
   - Tags: `["dpool", "dpool-verify"]`

**File Structure:**
```
contracts/vaults/dpool/
├── core/
│   ├── DPoolVaultLP.sol              // Abstract base asset vault
│   ├── DPoolVaultCurveLP.sol         // Curve LP vault implementation  
│   └── interfaces/
│       ├── IDPoolVaultLP.sol         // Vault interface
│       └── ICurveStableSwapNG.sol    // Curve pool interface
└── periphery/
    ├── DPoolCurvePeriphery.sol       // Curve pool asset conversion
    └── interfaces/
        └── IDPoolPeriphery.sol       // Periphery interface

deploy/09_dpool/
├── 01_deploy_vaults_and_peripheries.ts  // Direct deployment of contracts
├── 02_configure_periphery.ts           // Configure periphery contracts  
└── 03_verify_system.ts                 // System verification & health check
```

**Key Design Decisions Summary:**

* **Direct Deployment:** Each vault and periphery pair is deployed directly without factory complexity.
* **Base Asset Vaults:** Core vaults accept LP tokens but value them in base asset terms for consistent ERC4626 accounting.
* **DEX-Native Pricing:** Each vault uses its DEX's native pricing for `totalAssets()` calculation in base asset terms.
* **Periphery Pattern:** All pool asset conversions and DEX interactions isolated in periphery contracts.
* **Asset Whitelisting:** Periphery contracts restrict deposits/withdrawals to approved assets for security and control.
* **Dual Interface:** Advanced users can use vaults directly (LP tokens), regular users use periphery (whitelisted pool assets).
* **Clean Separation:** Vault handles base asset accounting, periphery handles conversions with slippage protection.
* **Simple Deployment:** Direct contract deployment for clarity and maintainability.
* **No Oracle Dependencies:** Each DEX uses its own pricing mechanisms.
* **Individual Farms:** Users choose specific LP exposures, each pool gets its own vault + periphery pair.
* **Custom Errors:** Gas-efficient error handling throughout all contracts.
* **Immutable Core:** Critical addresses and indices are immutable for security.
