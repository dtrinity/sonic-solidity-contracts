**Core Concept:**

dPOOL allows users to deposit whitelisted assets (stablecoins, major tokens) in exchange for vault shares representing diversified LP exposure across multiple DEXes. The deposited assets are converted into various LP tokens via router contracts, which handle DEX-specific interactions and slippage protection. Users receive ERC4626-compliant vault tokens representing their pro-rata share of the total managed LP portfolio. The core vault only accepts LP tokens and calculates their value, while router contracts handle the complex asset conversion logic.

**Key Benefits:**
- **Modular Architecture:** Core vault is simple and secure, complex logic in replaceable periphery contracts
- **Slippage Protection:** Router contracts can implement sophisticated slippage protection and MEV protection
- **Multi-LP Support:** Single vault can hold multiple LP tokens from different DEXes
- **Upgradeable Logic:** Router and adapter contracts can be upgraded without touching core vault

**Contracts:**

1. **`DPoolToken.sol` (e.g., `dpLP`)**
   * **Type:** ERC4626 Vault Token (Non-Upgradeable)
   * **Inherits:** `ERC4626`, `AccessControl`
   * **Core Logic:** Minimal, immutable ERC4626 implementation handling share accounting (`dpLP` mint/burn) relative to LP token values. Delegates complex operations.
   * **Key State:**
     * `baseAsset`: Address of the base denomination asset (e.g., USDC) for pricing. Immutable.
     * `collateralVault`: Address of the `DPoolCollateralVault`. Settable by `DEFAULT_ADMIN_ROLE`.
     * `router`: Address of the `DPoolRouter`. Settable by `DEFAULT_ADMIN_ROLE`.
     * `withdrawalFeeBps`: Fee charged on withdrawal (in base asset terms). Settable by `FEE_MANAGER_ROLE`.
     * `maxWithdrawalFeeBps`: Hardcoded maximum for `withdrawalFeeBps`.
   * **Roles:**
     * `DEFAULT_ADMIN_ROLE`: Can set `collateralVault`, `router`, manage other roles.
     * `FEE_MANAGER_ROLE`: Can set `withdrawalFeeBps` up to `maxWithdrawalFeeBps`.
   * **Delegation:**
     * `totalAssets()`: Delegates to `DPoolCollateralVault.getTotalAssetValue()` (returns value in base asset terms).
     * `_deposit()`: Takes user's asset, then delegates deposit logic to `DPoolRouter.deposit()`.
     * `_withdraw()`: Calculates fee, then delegates withdrawal logic to `DPoolRouter.withdraw()`.

2. **`DPoolCollateralVault.sol`**
   * **Type:** LP Token Management Contract (Non-Upgradeable, replaceable)
   * **Purpose:** Holds various LP tokens that can be priced in the base asset. Calculates total portfolio value using LP adapters.
   * **Key State:**
     * `poolToken`: Address of the `DPoolToken`. Immutable.
     * `baseAsset`: Address of the base denomination asset (`DPoolToken.asset()`). Immutable.
     * `router`: Address of the `DPoolRouter`. Settable by `poolToken` admin.
     * `adapterForLP`: `mapping(address lpToken => address adapter)`. Maps LP tokens to their `IDPoolLPAdapter`. Managed by `poolToken` admin.
     * `supportedLPTokens`: `address[]`. List of supported LP token addresses. Managed by `poolToken` admin.
   * **Key Functions:**
     * `getTotalAssetValue() returns (uint256 baseAssetValue)`: Iterates `supportedLPTokens`, calls `adapter.lpValueInBaseAsset()` for each, sums results. View.
     * `sendLP(address lpToken, uint256 amount, address recipient)`: Sends LP tokens. `onlyRouter`.
     * `addLPAdapter(address lpToken, address adapterAddress)`: Governance (`poolToken` admin) to add LP/adapter.
     * `removeLPAdapter(address lpToken)`: Governance (`poolToken` admin) to remove LP/adapter (requires zero balance).
     * `setRouter(address newRouter)`: Governance (`poolToken` admin).
     * `asset() returns (address)`: Returns base asset address. View.

3. **`DPoolRouter.sol`**
   * **Type:** Logic/Routing Contract (Non-Upgradeable, replaceable)
   * **Purpose:** Converts base asset <=> LP tokens via Adapters. Handles deposit/withdraw routing with slippage protection.
   * **Key State:**
     * `poolToken`: Address of `DPoolToken`. Immutable.
     * `collateralVault`: Address of `DPoolCollateralVault`. Immutable.
     * `baseAsset`: Address of the base asset (`poolToken.asset()`). Immutable.
     * `lpAdapters`: `mapping(address => address)`. Maps each LP token to its adapter. Managed by `DEFAULT_ADMIN_ROLE`.
     * `defaultDepositLP`: Default LP token for new deposits. Settable by `DEFAULT_ADMIN_ROLE`.
     * `maxSlippageBps`: Maximum allowed slippage for conversions. Settable by `DEFAULT_ADMIN_ROLE`.
   * **Roles:**
     * `DEFAULT_ADMIN_ROLE`: Initially granted to deployer, intended for governance. Can manage adapters, default LP, slippage settings.
     * `DPOOL_TOKEN_ROLE`: Granted to the associated `DPoolToken` contract. Allows token contract to call `deposit` and `withdraw`.
   * **Key Functions:**
     * `deposit(uint256 baseAssetAmount, address receiver, uint256 minLPAmount)`: `onlyRole(DPOOL_TOKEN_ROLE)`. Converts `baseAssetAmount` to default LP token via adapter with slippage protection, sends LP to `collateralVault`.
     * `withdraw(uint256 baseAssetAmount, address receiver, address owner, uint256 maxSlippage)`: `onlyRole(DPOOL_TOKEN_ROLE)`. Pulls required LP from `collateralVault`, converts back to `baseAssetAmount` via adapter, sends to `receiver`.
     * `addLPAdapter(address lpToken, address adapterAddress)`: `onlyRole(DEFAULT_ADMIN_ROLE)`.
     * `removeLPAdapter(address lpToken)`: `onlyRole(DEFAULT_ADMIN_ROLE)`.
     * `setDefaultDepositLP(address lpToken)`: `onlyRole(DEFAULT_ADMIN_ROLE)`.
     * `setMaxSlippageBps(uint256 newMaxSlippageBps)`: `onlyRole(DEFAULT_ADMIN_ROLE)`.

4. **`IDPoolLPAdapter.sol` (Interface)**
   * **Purpose:** Standard interface for converting base asset <=> specific LP tokens and valuing LP tokens.
   * **Key Functions:**
     * `convertToLP(uint256 baseAssetAmount, uint256 minLPAmount) returns (address lpToken, uint256 lpAmount)`: Converts base asset (pulled from caller) into LP token, sending result to `collateralVault`.
     * `convertFromLP(uint256 lpAmount, uint256 minBaseAssetAmount) returns (uint256 baseAssetAmount)`: Converts LP token (pulled from caller) back to base asset, sending to caller.
     * `previewConvertToLP(uint256 baseAssetAmount) view returns (address lpToken, uint256 lpAmount)`: Preview conversion result.
     * `previewConvertFromLP(uint256 lpAmount) view returns (uint256 baseAssetAmount)`: Preview conversion result.
     * `lpValueInBaseAsset(address lpToken, uint256 lpAmount) view returns (uint256 baseAssetValue)`: Calculates value of LP tokens in terms of base asset.
     * `lpToken() view returns (address)`: Returns the specific LP token address managed by this adapter.

5. **`CurveLPAdapter.sol` (Example Implementation)**
   * **Purpose:** Implements `IDPoolLPAdapter` for Curve StableSwap LP tokens.
   * **State:** Curve pool address, base asset, LP token address, `collateralVault` address, slippage settings.
   * **Logic:** Converts base asset to/from Curve LP tokens, handles single-sided liquidity operations, calculates LP value using Curve's pricing functions.

6. **`DPoolFlashRebalancer.sol`**
   * **Type:** Permissionless Flash Loan Rebalancing Contract (Non-Upgradeable)
   * **Purpose:** Enables zero-capital rebalancing of dPOOL vaults using flash loans. Anyone can run this to earn profit while optimizing vault allocation.
   * **Key State:**
     * `flashLoanProvider`: Address of flash loan provider (Aave, Balancer, etc.). Settable by admin.
     * `maxSlippageBps`: Maximum allowed slippage for rebalancing operations. Settable by admin.
     * `minProfitBps`: Minimum profit threshold for rebalancing to be worthwhile. Settable by admin.
     * `supportedVaults`: `mapping(address => bool)`. Vaults this rebalancer can operate on.
   * **Roles:**
     * `DEFAULT_ADMIN_ROLE`: Can update flash loan provider, slippage settings, add/remove supported vaults.
     * **No execution roles**: Anyone can call rebalancing functions (permissionless).
   * **Key Functions:**
     * `executeFlashRebalance(address vault, RebalanceParams calldata params)`: **Permissionless**. Executes optimal rebalancing using flash loans, caller keeps profit. Directly interacts with collateral vault and LP adapters.
     * `calculateOptimalRebalance(address vault) view returns (RebalanceParams memory)`: Calculates profitable rebalancing opportunity.
     * `estimateRebalanceProfit(address vault, RebalanceParams calldata params) view returns (uint256 profit)`: Estimates profit for a rebalancing operation.
     * `flashLoanCallback(address asset, uint256 amount, uint256 fee, bytes calldata params)`: Callback for flash loan execution.
     * `addSupportedVault(address vault)`: `onlyAdmin`. Adds vault to supported list.
     * `setFlashLoanProvider(address newProvider)`: `onlyAdmin`. Updates flash loan provider.

7. **`ICurveStableSwapNG.sol` (Interface)**
   * **Type:** Interface for Curve StableSwap NG pools
   * **Purpose:** Defines the interface for interacting with Curve StableSwap pools, used by `CurveLPAdapter`.
   * **Key Functions:**
     * `add_liquidity(uint256[] calldata amounts, uint256 min_mint_amount)`: Adds liquidity to pool.
     * `remove_liquidity_one_coin(uint256 burn_amount, int128 i, uint256 min_received)`: Removes liquidity for single token.
     * `calc_withdraw_one_coin(uint256 burn_amount, int128 i)`: Calculates expected output.
     * `coins(uint256 i)`: Returns token address at index.
     * `balanceOf(address account)`: LP token balance.

**Flow Summary:**

* **User Deposit:** 
  1. User → `DPoolToken.deposit(assets, receiver)` (ERC4626 standard)
  2. `DPoolToken._deposit()` → Transfer assets to DPoolToken → Approve router → `DPoolRouter.deposit(assets, receiver, minLPAmount)`
  3. `DPoolRouter` → Pull assets from DPoolToken → Approve adapter → `CurveLPAdapter.convertToLP(assets, minLPAmount)`
  4. `CurveLPAdapter` → Pull assets from router → Curve pool interaction (single-sided `add_liquidity`) → Send LP tokens to `DPoolCollateralVault`
  5. `DPoolToken` → Mint shares to receiver

* **User Withdraw:**
  1. User → `DPoolToken.withdraw(assets, receiver, owner)` (ERC4626 standard)
  2. `DPoolToken._withdraw()` → Calculate withdrawal fee → Burn shares → `DPoolRouter.withdraw(assetsAfterFee, receiver, owner, maxSlippage)`
  3. `DPoolRouter` → Calculate required LP amount with slippage buffer → `DPoolCollateralVault.sendLP(lpToken, requiredLPAmount, router)`
  4. `DPoolRouter` → Approve adapter → `CurveLPAdapter.convertFromLP(requiredLPAmount, minBaseAssetAmount)`
  5. `CurveLPAdapter` → Pull LP tokens from router → Curve pool interaction (single-sided `remove_liquidity_one_coin`) → Send base assets to router
  6. `DPoolRouter` → Send base assets to receiver

* **Flash Loan Rebalancing:** *Not yet implemented* - `DPoolFlashRebalancer` contract planned for future implementation

**Key Design Decisions Summary:**

* **Core Vault (`DPoolToken`):** Immutable ERC4626 for share accounting, fees, governance. Delegates complex operations to avoid upgrades.
* **Modularity:** Replaceable contracts (`DPoolCollateralVault`, `DPoolRouter`, `LPAdapters`) for complex logic, avoiding core vault upgrades.
* **Generic LP Support:** Supports any LP token convertible to/from base asset via Adapters, not limited to single DEX.
* **Value Accrual:** Share value tracks `totalAssets()` calculated from LP portfolio value relative to supply.
* **Withdrawal Fee:** Configurable fee in `DPoolToken`, managed by `FEE_MANAGER_ROLE`.
* **Slippage Protection:** Dedicated slippage controls in `DPoolRouter` and `LPAdapters` for safe conversions.
* **Permissionless Flash Loan Rebalancing:** Zero-capital, profit-driven rebalancing mechanism that anyone can execute, creating decentralized optimization incentives.
* **Simplified Rebalancing:** Single rebalancing mechanism via flash loans eliminates complexity and governance overhead.
* **Access Control:** `DPoolToken` manages roles. `DPoolCollateralVault` and `DPoolRouter` have separate role structures. Rebalancing is permissionless by design.
* **Error Handling:** Revert with details on failure, especially for slippage and insufficient liquidity scenarios.
* **Adapter Pattern:** Each LP type has its own adapter implementing `IDPoolLPAdapter` for DEX-specific logic.
* **Base Asset Denomination:** All pricing and accounting done in terms of a single base asset (e.g., USDC) for consistency. 