// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPool} from "../interface/IPool.sol";
import {IPoolAddressesProvider} from "../interface/IPoolAddressesProvider.sol";
import {IRewardsDistributor} from "../interface/IRewardsDistributor.sol";

contract RewardHelper {
    IPool public immutable POOL;
    IRewardsDistributor public immutable REWARDS_CONTROLLER;
    IPoolAddressesProvider public immutable ADDRESS_PROVIDER;

    error InvalidAddress();
    error NoRewardsFound();

    constructor(address _pool, address _rewardsController, address _addressProvider) {
        if (_pool == address(0) || _rewardsController == address(0) || _addressProvider == address(0)) revert InvalidAddress();
        POOL = IPool(_pool);
        REWARDS_CONTROLLER = IRewardsDistributor(_rewardsController);
        ADDRESS_PROVIDER = IPoolAddressesProvider(_addressProvider);
    }

    function getUserAccruedRewards(address user, address rewardToken) external view returns (uint256) {
        if (user == address(0) || rewardToken == address(0)) revert InvalidAddress();
        return REWARDS_CONTROLLER.getUserAccruedRewards(user, rewardToken);
    }

    function getUserTotalRewards(address user, address[] calldata assets, address rewardToken) external view returns (uint256) {
        if (user == address(0) || rewardToken == address(0) || assets.length == 0) revert InvalidAddress();
        return REWARDS_CONTROLLER.getUserRewards(assets, user, rewardToken);
    }

    function getAllUserRewards(address user, address[] calldata assets) external view returns (address[] memory rewardTokens, uint256[] memory rewardAmounts) {
        if (user == address(0) || assets.length == 0) revert InvalidAddress();
        return REWARDS_CONTROLLER.getAllUserRewards(assets, user);
    }

    function getUserRewardsAllReserves(address user, address rewardToken) external view returns (uint256) {
        if (user == address(0) || rewardToken == address(0)) revert InvalidAddress();
        address[] memory reserves = POOL.getReservesList();
        return REWARDS_CONTROLLER.getUserRewards(reserves, user, rewardToken);
    }

    function getUserRewardSummary(address user) external view returns (uint256 totalAccruedRewards, address[] memory rewardTokens, uint256[] memory accruedAmounts) {
        if (user == address(0)) revert InvalidAddress();
        rewardTokens = REWARDS_CONTROLLER.getRewardsList();
        accruedAmounts = new uint256[](rewardTokens.length);
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            uint256 accrued = REWARDS_CONTROLLER.getUserAccruedRewards(user, rewardTokens[i]);
            accruedAmounts[i] = accrued;
            totalAccruedRewards += accrued;
        }
        if (totalAccruedRewards == 0) revert NoRewardsFound();
    }

    function getUserRewardsForAsset(address user, address assetToken, address rewardToken) external view returns (uint256) {
        if (user == address(0) || assetToken == address(0) || rewardToken == address(0)) revert InvalidAddress();
        address[] memory assets = new address[](1);
        assets[0] = assetToken;
        return REWARDS_CONTROLLER.getUserRewards(assets, user, rewardToken);
    }

    function hasUserRewards(address user) external view returns (bool hasRewards, uint256 totalRewardValue) {
        if (user == address(0)) revert InvalidAddress();
        address[] memory rewardTokens = REWARDS_CONTROLLER.getRewardsList();
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            totalRewardValue += REWARDS_CONTROLLER.getUserAccruedRewards(user, rewardTokens[i]);
        }
        hasRewards = totalRewardValue > 0;
    }

    function getAllRewardTokens() external view returns (address[] memory) {
        return REWARDS_CONTROLLER.getRewardsList();
    }

    function getRewardTokensForAsset(address asset) external view returns (address[] memory) {
        if (asset == address(0)) revert InvalidAddress();
        return REWARDS_CONTROLLER.getRewardsByAsset(asset);
    }

    function getAllReserves() external view returns (address[] memory) {
        return POOL.getReservesList();
    }
}

