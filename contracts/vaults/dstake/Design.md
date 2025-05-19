**Core Concept:**

dSTAKE allows users to stake a dSTABLE token (like dUSD) to earn yield. The deposited dSTABLE is converted into various yield-bearing or convertible ERC20 tokens (`vault assets`) held in a collateral vault. The user receives an ERC4626-compliant vault token (e.g., `sdUSD`) representing their pro-rata share of the total managed assets. This share token appreciates over time as the underlying `vault assets` generate yield or increase in value relative to the dSTABLE asset.

**Contracts:**

1.  **`DStakeToken.sol` (e.g., `sdUSD`)**
    *   **Type:** ERC4626 Vault Token (Upgradeable)
    *   **Inherits:** `ERC4626`, `AccessControl`
    *   **Core Logic:** Minimal, immutable ERC4626 implementation handling share accounting (`sdUSD` mint/burn) relative to the underlying dSTABLE asset. Delegates complex operations.
    *   **Key State:**
        *   `dStable`: Address of the underlying dSTABLE token (e.g., dUSD). Immutable.
        *   `collateralVault`: Address of the `DStakeCollateralVault`. Settable by `DEFAULT_ADMIN_ROLE`.
        *   `router`: Address of the `DStakeRouter`. Settable by `DEFAULT_ADMIN_ROLE`.
        *   `withdrawalFeeBps`: Fee charged on withdrawal (in dSTABLE terms). Settable by `FEE_MANAGER_ROLE`.
        *   `maxWithdrawalFeeBps`: Hardcoded maximum for `withdrawalFeeBps`.
    *   **Roles:**
        *   `DEFAULT_ADMIN_ROLE`: Can set `collateralVault`, `router`, manage other roles.
        *   `FEE_MANAGER_ROLE`: Can set `withdrawalFeeBps` up to `maxWithdrawalFeeBps`.
    *   **Delegation:**
        *   `totalAssets()`: Delegates to `DStakeCollateralVault.getTotalAssetValue()` (returns value in dSTABLE terms).
        *   `_deposit()`: Takes user's dSTABLE, then delegates deposit logic to `DStakeRouter.deposit()`.
        *   `_withdraw()`: Calculates fee, then delegates withdrawal logic to `DStakeRouter.withdraw()`.

2.  **`DStakeCollateralVault.sol`**
    *   **Type:** Asset Management Contract (Non-Upgradeable, replaceable)
    *   **Purpose:** Holds various ERC20 `vault assets` that can be priced in the dSTABLE asset. Calculates total value. Avoids holding rebasing tokens directly (must be wrapped).
    *   **Key State:**
        *   `stakeToken`: Address of the `DStakeToken`. Immutable.
        *   `dStable`: Address of the underlying dSTABLE token (`DStakeToken.asset()`). Immutable.
        *   `router`: Address of the `DStakeRouter`. Settable by `stakeToken` admin.
        *   `adapterForAsset`: `mapping(address vaultAsset => address adapter)`. Maps `vault asset` to its `IDStableConversionAdapter`. Managed by `stakeToken` admin.
        *   `supportedAssets`: `address[]`. List of `vault asset` addresses. Managed by `stakeToken` admin.
    *   **Key Functions:**
        *   `getTotalAssetValue() returns (uint256 dStableValue)`: Iterates `supportedAssets`, calls `adapter.assetValueInDStable()` for each, sums results. View.
        *   `sendAsset(address vaultAsset, uint256 amount, address recipient)`: Sends `vaultAsset`. `onlyRouter`.
        *   `addAdapter(address vaultAsset, address adapterAddress)`: Governance (`stakeToken` admin) to add asset/adapter.
        *   `removeAdapter(address vaultAsset)`: Governance (`stakeToken` admin) to remove asset/adapter (requires zero balance).
        *   `setRouter(address newRouter)`: Governance (`stakeToken` admin).
        *   `asset() returns (address)`: Returns dSTABLE asset address. View.

3.  **`DStakeRouter.sol`**
    *   **Type:** Logic/Routing Contract (Non-Upgradeable, replaceable)
    *   **Purpose:** Converts dSTABLE asset <=> `vault assets` via Adapters. Handles deposit/withdraw routing and asset exchange/rebalancing.
    *   **Key State:**
        *   `DStakeToken`: Address of `DStakeToken`. Immutable.
        *   `collateralVault`: Address of `DStakeCollateralVault`. Immutable.
        *   `dStable`: Address of the dSTABLE token (`stakeToken.asset()`). Immutable.
        *   `vaultAssetToAdapter`: `mapping(address => address)`. Maps each vault asset to its adapter. Managed by `DEFAULT_ADMIN_ROLE`.
        *   `defaultDepositVaultAsset`: Default vault asset for new deposits. Settable by `DEFAULT_ADMIN_ROLE`.
    *   **Roles:**
        *   `DEFAULT_ADMIN_ROLE`: Initially granted to the deployer, intended to be transferred to governance. Can manage adapters, default deposit asset, and grant/revoke `COLLATERAL_EXCHANGER_ROLE`.
        *   `DSTAKE_TOKEN_ROLE`: Granted to the associated `DStakeToken` contract. Allows the token contract to call `deposit` and `withdraw`.
        *   `COLLATERAL_EXCHANGER_ROLE`: Can call `exchangeAssets`. Managed by `DEFAULT_ADMIN_ROLE`.
    *   **Key Functions:**
        *   `deposit(uint256 dStableAmount, address receiver)`: `onlyRole(DSTAKE_TOKEN_ROLE)`. Called by `DStakeToken`. Converts `dStableAmount` to the default vault asset via its adapter, sends `vaultAsset` to `collateralVault`.
            1.  Pulls `dStableAmount` from `stakeToken`.
            2.  Calls `adapter.convertToVaultAsset(dStableAmount)` depositing result to `collateralVault`.
        *   `withdraw(uint256 dStableAmount, address receiver, address owner)`: `onlyRole(DSTAKE_TOKEN_ROLE)`. Called by `DStakeToken`. Pulls required `vaultAsset` from `collateralVault` via `sendAsset`, converts it back to `dStableAmount` via adapter, sends dSTABLE to `receiver`.
            1.  Calculates required `vaultAssetAmount` using `adapter.previewWithdraw`.
            2.  Calls `collateralVault.sendAsset()` to pull `vaultAsset` to router.
            3.  Calls `adapter.convertFromVaultAsset(vaultAssetAmount)`.
        *   `exchangeAssetsUsingAdapters(address fromVaultAsset, address toVaultAsset, uint256 fromVaultAssetAmount)`: `onlyRole(COLLATERAL_EXCHANGER_ROLE)`. Swaps `fromVaultAssetAmount` of one `vaultAsset` for another via their adapters, using dSTABLE as intermediary.
            1.  Get adapters for `fromVaultAsset` and `toVaultAsset`.
            2.  Calculate equivalent `dStableAmount` of `fromVaultAssetAmount`.
            3.  Call `collateralVault.sendAsset()` to pull `fromVaultAsset`.
            4.  Call `fromAdapter.convertFromVaultAsset()` sending dSTABLE to router.
            5.  Call `toAdapter.convertToVaultAsset()` using received dSTABLE, depositing result to `collateralVault`.
            6.  Transfers `fromVaultAsset` to `collateralVault`.
            7.  Calls `collateralVault.sendAsset()` to send `calculatedToVaultAssetAmount` of `toVaultAsset` to the solver (`msg.sender`).
        *   `exchangeAssets(address fromVaultAsset, address toVaultAsset, uint256 fromVaultAssetAmount, uint256 minToVaultAssetAmount)`: `onlyRole(COLLATERAL_EXCHANGER_ROLE)`. Facilitates asset swaps driven by an external solver. Calculates expected output based on input value and ensures it meets minimum slippage requirement.
            1. Get adapters for `fromVaultAsset` and `toVaultAsset`.
            2. Calls `fromAdapter.previewConvertFromVaultAsset` to get `dStableValueIn` from `fromVaultAssetAmount`.
            3. Calls `toAdapter.previewConvertToVaultAsset` with `dStableValueIn` to get `calculatedToVaultAssetAmount`.
            4. Requires `calculatedToVaultAssetAmount >= minToVaultAssetAmount` (Slippage Check).
            5. Pulls `fromVaultAssetAmount` of `fromVaultAsset` from solver (`msg.sender`).
            6. Transfers `fromVaultAsset` to `collateralVault`.
            7. Calls `collateralVault.sendAsset()` to send `calculatedToVaultAssetAmount` of `toVaultAsset` to the solver (`msg.sender`).
        *   `addAdapter(address vaultAsset, address adapterAddress)`: `onlyRole(DEFAULT_ADMIN_ROLE)`.
        *   `removeAdapter(address vaultAsset)`: `onlyRole(DEFAULT_ADMIN_ROLE)`.
        *   `setDefaultDepositVaultAsset(address vaultAsset)`: `onlyRole(DEFAULT_ADMIN_ROLE)`.
        *   `addCollateralExchanger(address exchanger)`: `onlyRole(DEFAULT_ADMIN_ROLE)`.
        *   `removeCollateralExchanger(address exchanger)`: `onlyRole(DEFAULT_ADMIN_ROLE)`.

4.  **`IDStableConversionAdapter.sol` (Interface)**
    *   **Purpose:** Standard interface for converting dSTABLE asset <=> specific `vault asset` and valuing the `vault asset`.
    *   **Key Functions:**
        *   `convertToVaultAsset(uint256 dStableAmount) returns (address vaultAsset, uint256 vaultAssetAmount)`: Converts dSTABLE (pulled from caller) into `vaultAsset`, sending result to `collateralVault`.
        *   `convertFromVaultAsset(uint256 vaultAssetAmount) returns (uint256 dStableAmount)`: Converts `vaultAsset` (pulled from caller) back to dSTABLE, sending `dStableAmount` to caller.
        *   `previewConvertToVaultAsset(uint256 dStableAmount) view returns (address vaultAsset, uint256 vaultAssetAmount)`: Preview conversion result.
        *   `previewConvertFromVaultAsset(uint256 vaultAssetAmount) view returns (uint256 dStableAmount)`: Preview conversion result.
        *   `assetValueInDStable(address vaultAsset, uint256 vaultAssetAmount) view returns (uint256 dStableValue)`: Calculates the value of `vaultAssetAmount` in terms of the dSTABLE asset.
        *   `vaultAsset() view returns (address)`: Returns the specific `vault asset` address managed by this adapter.

5.  **`WrappedDLendConversionAdapter.sol` (Example Implementation)**
    *   **Purpose:** Implements `IDStableConversionAdapter` for a wrapped dLEND `aToken` (e.g., `wddUSD`). Wrapped using StaticATokenLM.sol
    *   **State:** Protocol addresses (`dLendLendingPool`), asset addresses (`dUSD`, `wddUSD`), `collateralVault` address.
    *   **Logic:** Wraps/unwraps dUSD/`wddUSD`, deposits/withdraws from dLEND (on behalf of `collateralVault`), uses appropriate rates for `assetValueInDStable`.

6.  **`DStakeRewardManagerDLend.sol`**
    *   **Type:** Reward Management Contract (Non-Upgradeable)
    *   **Inherits:** `RewardClaimable`
    *   **Purpose:** Manages claiming of dLEND rewards earned by a specific `StaticATokenLM` wrapper (associated with a `DStakeCollateralVault`) and compounds dStable (provided by a caller) into the `DStakeCollateralVault`.
    *   **Key State:**
        *   `dStakeCollateralVault`: Address of the `DStakeCollateralVault`. Immutable.
        *   `dStakeRouter`: Address of the `DStakeRouterDLend`. Immutable.
        *   `dLendRewardsController`: Address of the dLEND `RewardsController`. Settable by `DEFAULT_ADMIN_ROLE`.
        *   `targetStaticATokenWrapper`: Address of the `StaticATokenLM` instance earning rewards. Immutable.
        *   `dLendAssetToClaimFor`: The actual aToken in dLEND held by the wrapper. Immutable.
        *   Inherited from `RewardClaimable`: `exchangeAsset` (dStable), `treasury`, `maxTreasuryFeeBps`, `treasuryFeeBps`, `exchangeThreshold`.
    *   **Roles:**
        *   `DEFAULT_ADMIN_ROLE`: Can set `dLendRewardsController`, manage other roles from `RewardClaimable` and `AccessControl`.
        *   `REWARDS_MANAGER_ROLE`: Can call `setTreasury`, `setTreasuryFeeBps`, `setExchangeThreshold` (from `RewardClaimable`).
    *   **Key Functions:**
        *   `compoundRewards(address[] calldata tokensToClaim, uint256 amountExchangeAssetToProvide, address receiverForNetRewards)`: (Inherited from `RewardClaimable`, but core to this contract's utility). Claims specified `tokensToClaim` from dLEND for `targetStaticATokenWrapper`, sends net rewards (after treasury fee) to `receiverForNetRewards`, and processes `amountExchangeAssetToProvide` (dStable) for compounding.
        *   `_claimRewards(address[] calldata tokensToClaim, address receiverForClaimedRawRewards)`: Internal override. Claims rewards from `dLendRewardsController` on behalf of `targetStaticATokenWrapper`.
        *   `_processExchangeAssetDeposit(uint256 amountDStableToCompound)`: Internal override. Converts `amountDStableToCompound` to the `dStakeRouter.defaultDepositVaultAsset()` via its adapter and ensures it's deposited into `dStakeCollateralVault`.
        *   `setDLendRewardsController(address newDLendRewardsController)`: `onlyRole(DEFAULT_ADMIN_ROLE)`. Updates the dLEND Rewards Controller address.
        *   `authorizeClaimerOnDLendReminder()`: Pure function that reverts with a message reminding the user to authorize this contract as a claimer on the dLEND Rewards Controller for the `targetStaticATokenWrapper`.

**Flow Summary:**

*   **Deposit:** User -> `DStakeToken.deposit` -> `Router.deposit` -> `Adapter.convertToVaultAsset` -> (Protocol Interaction) -> `CollateralVault` receives `vaultAsset` -> `DStakeToken` mints shares.
*   **Withdraw:** User -> `DStakeToken.withdraw` -> `Router.withdraw` -> `CollateralVault.sendAsset` (to Router) -> `Adapter.convertFromVaultAsset` -> (Protocol Interaction) -> User receives dSTABLE -> `DStakeToken` burns shares.

**Key Design Decisions Summary:**

*   **Core Vault (`DStakeToken`):** Immutable ERC4626 for share accounting, fees, governance.
*   **Modularity:** Replaceable contracts (`CollateralVault`, `Router`, `Adapters`) for complex logic, avoiding core upgrades.
*   **Generic Assets:** Supports any ERC20 (`vault asset`) convertible to/from dSTABLE via Adapters.
*   **Value Accrual:** Share value tracks `totalAssets()` relative to supply.
*   **Withdrawal Fee:** Configurable fee in `DStakeToken`, managed by `FEE_MANAGER_ROLE`.
*   **Rebalancing:** Dedicated `exchangeAssets*` functions in `Router`, managed by `COLLATERAL_EXCHANGER_ROLE`.
*   **Error Handling:** Revert with details on failure.
*   **Access Control:** `DStakeToken` manages its own roles (`DEFAULT_ADMIN_ROLE`, `FEE_MANAGER_ROLE`). `DStakeCollateralVault` has its own `DEFAULT_ADMIN_ROLE` and `ROUTER_ROLE`. `DStakeRouter` has its own `DEFAULT_ADMIN_ROLE`, `DSTAKE_TOKEN_ROLE`, and `COLLATERAL_EXCHANGER_ROLE`.