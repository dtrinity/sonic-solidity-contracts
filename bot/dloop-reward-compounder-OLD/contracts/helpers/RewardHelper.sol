// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal placeholder interface copies for compilation isolation
interface IRewardsDistributor {
    function getUserAccruedRewards(address user, address reward) external view returns (uint256);
    function getUserRewards(address[] calldata assets, address user, address reward) external view returns (uint256);
    function getRewardsList() external view returns (address[] memory);
    function getAllUserRewards(address[] calldata assets, address user) external view returns (address[] memory, uint256[] memory);
    function getRewardsByAsset(address asset) external view returns (address[] memory);
}

interface IPool {
    function getReservesList() external view returns (address[] memory);
}

interface IPoolAddressesProvider {}

contract RewardHelper {
    IPool public immutable POOL;
    IRewardsDistributor public immutable REWARDS_CONTROLLER;
    IPoolAddressesProvider public immutable ADDRESS_PROVIDER;

    error InvalidAddress();
    error NoRewardsFound();

    constructor(address _pool, address _rewards, address _provider) {
        if (_pool == address(0) || _rewards == address(0) || _provider == address(0)) revert InvalidAddress();
        POOL = IPool(_pool);
        REWARDS_CONTROLLER = IRewardsDistributor(_rewards);
        ADDRESS_PROVIDER = IPoolAddressesProvider(_provider);
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

    function getUserRewardSummary(address user)
        external
        view
        returns (uint256 totalAccruedRewards, address[] memory rewardTokens, uint256[] memory accruedAmounts)
    {
        if (user == address(0)) revert InvalidAddress();
        rewardTokens = REWARDS_CONTROLLER.getRewardsList();
        accruedAmounts = new uint256[](rewardTokens.length);
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            accruedAmounts[i] = REWARDS_CONTROLLER.getUserAccruedRewards(user, rewardTokens[i]);
            totalAccruedRewards += accruedAmounts[i];
        }
        if (totalAccruedRewards == 0) revert NoRewardsFound();
    }

    function getAllReserves() external view returns (address[] memory) {
        return POOL.getReservesList();
    }
}

