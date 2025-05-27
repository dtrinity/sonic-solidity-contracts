# DStakeRewardManagerDLend Design Overview

## 1. Purpose

The `DStakeRewardManagerDLend` contract is designed to manage and compound rewards earned from the dLEND protocol on behalf of a designated "Static AToken Wrapper" contract. Specifically, it:

1.  **Claims** specified reward tokens (e.g., dUSD, USDC) accrued by a `targetStaticATokenWrapper` from dLEND's `RewardsController`.
2.  **Processes an `exchangeAsset`** (typically dStable, like dUSD) provided by a caller. This `exchangeAsset` is converted into the default deposit asset of an associated `DStakeCollateralVault` and then deposited into that vault. This step is intended to "establish wrapper positions" before claiming rewards.
3.  **Distributes** the claimed rewards: a configurable fee is sent to a `treasury`, and the net rewards are sent to a `receiver` specified by the caller.

It inherits from the `RewardClaimable` abstract contract, which provides foundational logic for reward management, fee handling, and access control.

## 2. Key Components & Dependencies

The `DStakeRewardManagerDLend` contract interacts with several key components:

*   **`DStakeCollateralVault` (Interface: `IDStakeCollateralVault`)**:
    *   The ultimate beneficiary vault where the compounded `exchangeAsset` (after conversion) is deposited.
    *   The source that defines the `dStable` token used as the `exchangeAsset`.
*   **`DStakeRouterDLend`**:
    *   A router contract that provides information about:
        *   The `defaultDepositVaultAsset` for the `DStakeCollateralVault`.
        *   The appropriate `IDStableConversionAdapter` to use for converting the `exchangeAsset` (dStable) into this `defaultDepositVaultAsset`.
*   **`IDLendRewardsController` (Aave/dLEND `RewardsController`)**:
    *   The external Aave/dLEND contract from which rewards are claimed.
    *   The `DStakeRewardManagerDLend` calls `claimRewardsOnBehalf` on this controller.
*   **`targetStaticATokenWrapper` (Address)**:
    *   The address of the specific Static AToken Wrapper contract that is earning rewards in the dLEND protocol. This manager instance is tied to this wrapper.
*   **`dLendAssetToClaimFor` (Address)**:
    *   The address of the actual underlying AToken (e.g., aDUSD on dLEND) held by the `targetStaticATokenWrapper`. Rewards are accrued on this specific asset within dLEND.
*   **`exchangeAsset` (Address, typically dStable like dUSD)**:
    *   The asset (defined by `IDStakeCollateralVault(_dStakeCollateralVault).dStable()`) that callers provide to the `compoundRewards` function. This asset is then processed and deposited into the `DStakeCollateralVault`.
*   **Reward Tokens (Addresses)**:
    *   Various ERC20 tokens (e.g., stablecoins, governance tokens) that are distributed as rewards by the dLEND protocol and can be claimed by this manager.
*   **Adapters (`IDStableConversionAdapter`)**:
    *   Smart contracts registered in `DStakeRouterDLend`.
    *   Responsible for converting the `exchangeAsset` (dStable) into the `DStakeCollateralVault`'s `defaultDepositVaultAsset`.
    *   Expected to pull the `exchangeAsset` from this manager (after approval) and transfer the converted asset directly to the `DStakeCollateralVault`.
*   **`treasury` (Address)**:
    *   The address that receives a portion of the claimed rewards as a fee.
*   **Access Control Roles**:
    *   `DEFAULT_ADMIN_ROLE`: Can change critical configurations like the `dLendRewardsController` address.
    *   `REWARDS_MANAGER_ROLE`: Can update financial parameters like `treasury` address, `treasuryFeeBps`, and `exchangeThreshold`.

## 3. Core Workflow: `compoundRewards` Function

The primary interaction occurs through the `compoundRewards(uint256 amount, address[] calldata rewardTokens, address receiver)` function:

1.  **Caller Input & Validation**:
    *   A user or bot calls `compoundRewards`.
    *   `amount`: The quantity of `exchangeAsset` (dStable) the caller wishes to contribute for compounding into the `DStakeCollateralVault`.
    *   `rewardTokens`: An array of ERC20 token addresses representing the rewards to be claimed from dLEND.
    *   `receiver`: The address that will receive the net claimed rewards (after the treasury fee).
    *   Initial checks ensure `amount` meets `exchangeThreshold`, `receiver` is not a zero address, and `rewardTokens` is not empty.

2.  **Receive `exchangeAsset`**:
    *   The contract transfers `amount` of `exchangeAsset` from `msg.sender` (the caller) to itself (`address(this)`).

3.  **Process `exchangeAsset` Deposit (`_processExchangeAssetDeposit`)**:
    *   This step occurs *before* rewards are claimed.
    *   The `defaultDepositVaultAsset` for the `dStakeCollateralVault` is fetched from `dStakeRouter`.
    *   The corresponding `IDStableConversionAdapter` for this asset is fetched from `dStakeRouter`.
    *   The manager contract approves the adapter to spend the received `amount` of `exchangeAsset`.
    *   The manager calls `adapter.convertToVaultAsset(amount)`. This adapter is expected to:
        1.  Pull `amount` of `exchangeAsset` from the manager contract.
        2.  Perform the necessary swaps/conversions to transform it into `defaultDepositVaultAsset`.
        3.  Transfer the resulting `defaultDepositVaultAsset` directly to the `dStakeCollateralVault`.
    *   An `ExchangeAssetProcessed` event is emitted.

4.  **Claim Rewards from dLEND (`_claimRewards`)**:
    *   This step occurs *after* the `exchangeAsset` has been processed.
    *   The manager iterates through the `rewardTokens` array.
    *   For each `rewardToken`:
        *   It calls `dLendRewardsController.claimRewardsOnBehalf(...)` with the following key parameters:
            *   `assets`: An array containing only `dLendAssetToClaimFor`.
            *   `amount`: `type(uint256).max` (to claim all available balance of that reward token).
            *   `user`: `targetStaticATokenWrapper` (the entity that earned the rewards).
            *   `to`: `address(this)` (the manager contract itself receives the raw claimed rewards initially).
            *   `reward`: The current `rewardToken` being claimed.
        *   **Crucial Prerequisite**: This call will only succeed if `targetStaticATokenWrapper` has previously authorized this manager contract's address as a claimer by calling `setClaimer(targetStaticATokenWrapper, address(this_manager))` on the `dLendRewardsController`.
    *   The amounts of each reward token successfully claimed are recorded.

5.  **Distribute Claimed Rewards**:
    *   The manager iterates through the claimed `rewardTokens` and their `rewardAmounts`.
    *   For each `rewardToken`:
        1.  The `treasuryFee` is calculated based on `rewardAmount` and `treasuryFeeBps`.
        2.  The `treasuryFee` amount of the `rewardToken` is transferred to the `treasury` address.
        3.  The remaining amount (`rewardAmount - treasuryFee`) of the `rewardToken` is transferred to the `receiver` address originally specified by the caller of `compoundRewards`.

6.  **Event Emission**:
    *   A `RewardCompounded` event is emitted early in the process.

## 4. Setup Requirements & Dependencies

For the `DStakeRewardManagerDLend` contract to function correctly, the following setup and conditions are essential:

1.  **Deployment Configuration**:
    *   All immutable and settable state variables must be correctly initialized during deployment or by admin functions:
        *   `dStakeCollateralVault`
        *   `dStakeRouter`
        *   `dLendRewardsController`
        *   `targetStaticATokenWrapper`
        *   `dLendAssetToClaimFor`
        *   `treasury`
        *   `maxTreasuryFeeBps`, `initialTreasuryFeeBps`
        *   `initialExchangeThreshold`
2.  **`setClaimer` Authorization (Critical)**:
    *   The `targetStaticATokenWrapper` (or its owner/manager) **MUST** call `setClaimer(targetStaticATokenWrapper, address(DStakeRewardManagerDLend_instance))` on the live `IDLendRewardsController` contract. Without this, reward claiming will fail.
3.  **`DStakeRouterDLend` Configuration**:
    *   The `DStakeRouterDLend` instance must have a `defaultDepositVaultAsset` configured for the associated `DStakeCollateralVault`.
    *   The router must have a valid, trusted, and functional `IDStableConversionAdapter` registered for converting `exchangeAsset` (dStable) to this `defaultDepositVaultAsset`.
4.  **Role Assignment**:
    *   `DEFAULT_ADMIN_ROLE` and `REWARDS_MANAGER_ROLE` should be granted to appropriate secure admin/management multisigs or addresses.
5.  **Token Approvals & Balances**:
    *   The caller of `compoundRewards` must have sufficient `exchangeAsset` balance and must have approved the `DStakeRewardManagerDLend` contract to spend at least `amount` of this asset.
    *   The `dLendRewardsController` and associated reward token contracts must be operational and have rewards available for `targetStaticATokenWrapper`.

## 5. Inheritance & Key Features

*   **Inherits from `RewardClaimable`**: Provides base functionality for:
    *   Managing `treasury`, `treasuryFeeBps`, `exchangeThreshold`.
    *   Calculating treasury fees (`getTreasuryFee`).
    *   Basic structure for `compoundRewards`, `_claimRewards`, `_processExchangeAssetDeposit` (though `DStakeRewardManagerDLend` overrides these significantly).
*   **Inherits from `AccessControl`**: For role-based permissioning of administrative functions.
*   **Inherits from `ReentrancyGuard`**: The `compoundRewards` function uses the `nonReentrant` modifier to prevent reentrancy attacks.
*   **Uses `SafeERC20`**: For safe interaction with ERC20 tokens.

## 6. Assumptions

*   The Aave/dLEND rewards mechanism, particularly the `RewardsController` and its `claimRewardsOnBehalf` function, remains consistent with the expected interface and behavior.
*   The `IDStableConversionAdapter` contracts registered in the `DStakeRouterDLend` are trusted, secure, and function as expected (i.e., they correctly convert the dStable and deposit the target asset to the collateral vault).
*   The `dStakeCollateralVault` and `dStakeRouter` are correctly deployed and configured.
*   Relevant ERC20 tokens (exchangeAsset, rewardTokens, vault assets) conform to the ERC20 standard.

This design allows for automated claiming and compounding of dLEND rewards, integrating the value back into the dStake ecosystem while distributing rewards to participants.
