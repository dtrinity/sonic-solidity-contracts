// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRewardsDistributor {
    function getUserAccruedRewards(address user, address reward) external view returns (uint256);
    function getUserRewards(address[] calldata assets, address user, address reward) external view returns (uint256);
    function getAllUserRewards(address[] calldata assets, address user) external view returns (address[] memory, uint256[] memory);
    function getRewardsList() external view returns (address[] memory);
    function getRewardsByAsset(address asset) external view returns (address[] memory);
}

