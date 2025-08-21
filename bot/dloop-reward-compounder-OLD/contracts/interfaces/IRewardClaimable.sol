// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal interface for reward claiming functionality
interface IRewardClaimable {
    function claimRewards(address[] calldata assets, address to, address reward) external returns (uint256);
    function getUserAccruedRewards(address user, address reward) external view returns (uint256);
    function getUserRewards(address[] calldata assets, address user, address reward) external view returns (uint256);
    function getAllUserRewards(address[] calldata assets, address user) external view returns (address[] memory, uint256[] memory);
    function getRewardsList() external view returns (address[] memory);
}
