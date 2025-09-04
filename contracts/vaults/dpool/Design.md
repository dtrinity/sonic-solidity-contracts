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
- **Shared Fee Logic:** Uses `SupportsWithdrawalFee` for consistent withdrawal fee calculation and preview functions

**Contracts:**

1. **`DPoolVaultLP.sol` (Base Contract)**
   * **Type:** Abstract ERC4626 Vault for LP Tokens (Non-Upgradeable)
   * **Inherits:** `ERC4626`, `AccessControl`, `ReentrancyGuard`, `IDPoolVaultLP`, `SupportsWithdrawalFee`
   * **Core Logic:** Abstract ERC4626 vault where the `asset()` is the LP token itself. `totalAssets()` thus represents the total LP tokens held by the vault. Withdrawal fees are collected from withdrawing users and remain in the vault, effectively increasing the value of all outstanding shares.
   * **Key State:**
     * `asset()`: The LP token address. This is the underlying asset of the ERC4626 vault. Immutable (set via ERC4626 constructor).
     * `LP_TOKEN`: Address of the specific LP token this vault accepts (same as `asset()`). Immutable.
     * `withdrawalFeeBps_`: Fee charged on withdrawal, paid in LP tokens. Inherited from `SupportsWithdrawalFee`. Settable by `FEE_MANAGER_ROLE`. Fees collected remain in the vault, benefiting existing shareholders.
     * `MAX_WITHDRAWAL_FEE_BPS_CONFIG`: Hardcoded maximum for withdrawal fees (5%).
   * **Roles:**
     * `DEFAULT_ADMIN_ROLE`: Can manage other roles.
     * `FEE_MANAGER_ROLE`: Can set withdrawal fees up to maximum via `setWithdrawalFee()`.
   * **Key Functions:**
     * `deposit(uint256 lpAmount, address receiver)`: Standard ERC4626 deposit accepting LP tokens directly. `lpAmount` is the amount of `asset()` (LP tokens) deposited.
     * `withdraw(uint256 assets, address receiver, address owner)`: Standard ERC4626 withdrawal returning LP tokens. `assets` refers to the net amount of LP tokens the user wishes to receive. The actual amount of LP tokens deducted from the vault to fulfill this request will be higher due to the withdrawal fee, which remains in the vault.
     * `totalAssets()`: Returns the total amount of `asset()` (LP tokens) held by the vault. This is the standard ERC4626 behavior.
     * `previewDepositLP(uint256 lpAmount)`: Preview shares for LP token deposit (equivalent to `previewDeposit(lpAmount)`).
     * `previewWithdraw(uint256 assets)`: Preview shares needed for a net withdrawal of `assets` (LP tokens), accounting for withdrawal fees that remain in the vault.
     * `previewRedeem(uint256 shares)`: Preview net `assets` (LP tokens) received for share redemption, after accounting for withdrawal fees that remain in the vault.
     * `previewLPValue(uint256 lpAmount)`: Auxiliary function. Preview the *external* value of a given `lpAmount` in terms of a "base asset" (e.g., USDC) using DEX-specific logic (like `calc_withdraw_one_coin`). This is for informational purposes and does **not** affect the core ERC4626 share calculation, which is based purely on LP token amounts.

2. **`SupportsWithdrawalFee.sol`**
   * **Type:** Shared Abstract Contract for Withdrawal Fee Logic
   * **Purpose:** Provides consistent withdrawal fee calculation, state management, and preview functions across different vault types (dSTAKE and dPOOL).
   * **Key State:**
     * `withdrawalFeeBps_`: Internal state variable for withdrawal fee in basis points.
   * **Key Functions:**
     * `_initializeWithdrawalFee(uint256)`: Initialize fee during construction/initialization.
     * `_setWithdrawalFee(uint256)`: Internal function to set fee with validation.
     * `_calculateWithdrawalFee(uint256)`: Calculate fee amount for given asset amount.
     * `_getNetAmountAfterFee(uint256)`: Calculate net amount after deducting fees (for `previewRedeem`).
     * `_getGrossAmountRequiredForNet(uint256)`: Calculate gross amount needed for desired net amount (for `previewWithdraw`).
     * `getWithdrawalFeeBps()`: Public getter for current fee.
     * `_maxWithdrawalFeeBps()`: Abstract function for inheriting contracts to define maximum fee.
   * **Events:**
     * `WithdrawalFeeSet(uint256)`: Emitted when fee is updated.
     * `WithdrawalFeeApplied(address indexed owner, address indexed receiver, uint256 feeAmount)`: Emitted when fee is charged.

3. **`DPoolVaultCurveLP.sol` (Curve Implementation)**
   * **Type:** Curve LP Token ERC4626 Vault (Non-Upgradeable)
   * **Inherits:** `DPoolVaultLP`
   * **Core Logic:** Concrete ERC4626 vault where `asset()` is the Curve LP token. Share valuation is based on the amount of LP tokens. Withdrawal fees accrue to the vault.
   * **Key State:**
     * `asset()`: The Curve LP token address. Immutable (inherited).
     * `POOL`: Address of the Curve pool. Immutable. (Used for `previewLPValue`).
     * `LP_TOKEN`: Address of the Curve LP token that this vault accepts (same as `asset()`). Immutable.
     * `BASE_ASSET_INDEX`: Index of a chosen base asset within the Curve pool. Immutable (auto-determined). This is used **only** for the informational `previewLPValue` function to provide an external valuation in terms of this base asset. It does not affect core share mechanics.
   * **Implementation:**
     * `deposit(uint256 lpAmount, address receiver)`: Accepts LP tokens directly. Shares are minted based on the proportion of `lpAmount` to `totalAssets()` (total LP tokens in vault).
     * `withdraw(uint256 assets, address receiver, address owner)`: Burns shares, returns `assets` (LP tokens) to the user. Withdrawal fees are kept in the vault.
     * `totalAssets()`: Returns `IERC20(LP_TOKEN).balanceOf(address(this))`. This is the standard ERC4626 behavior and is **not** overridden to return a value in a different base asset.
     * `pool()`: Returns the Curve pool address.
     * `baseAssetIndex()`: Returns the index of the chosen base asset in the pool (for `previewLPValue`).

4. **`DPoolCurvePeriphery.sol` (Curve DEX Handler)**
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
* **LP Token as Core Asset:** Core ERC4626 vaults (`DPoolVaultLP` and its derivatives) use the specific LP token as their `asset()`. Share valuation is based on the quantity of these LP tokens.
* **Informational Base Asset Valuation:** Functions like `previewLPValue` provide an *external, informational* valuation of LP tokens in a chosen "base asset" (e.g., USDC) using DEX-native pricing. This does **not** alter the core ERC4626 mechanics, which operate purely on LP token quantities.
* **Withdrawal Fees Accrue to Shareholders:** Withdrawal fees are paid by withdrawing users in LP tokens and remain within the vault. This increases the `totalAssets()` (LP tokens) relative to `totalSupply()` (shares), thereby appreciating the value of all outstanding shares for the benefit of existing LPs. There is no separate fee sweeping mechanism by design.
* **Shared Fee Logic:** Uses `SupportsWithdrawalFee` for consistent withdrawal fee calculation (though fees accrue to vault, not a separate treasury).
* **Periphery Pattern:** All pool asset conversions (e.g., USDC to LP token) and DEX interactions are isolated in periphery contracts.
* **Asset Whitelisting:** Periphery contracts restrict deposits/withdrawals to approved assets for security and control.
* **Dual Interface:** Advanced users can use vaults directly (LP tokens), regular users use periphery (whitelisted pool assets).
* **Clean Separation:** Vault handles LP token accounting and ERC4626 share mechanics. Periphery handles base asset conversions with slippage protection.
* **Simple Deployment:** Direct contract deployment for clarity and maintainability.
* **No Oracle Dependencies:** Each DEX uses its own pricing mechanisms.
* **Individual Farms:** Users choose specific LP exposures, each pool gets its own vault + periphery pair.
* **Custom Errors:** Gas-efficient error handling throughout all contracts.
* **Immutable Core:** Critical addresses and indices are immutable for security.
