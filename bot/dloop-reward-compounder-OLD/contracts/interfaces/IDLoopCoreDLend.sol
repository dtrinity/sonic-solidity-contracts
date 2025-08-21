// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDLoopCoreDLend {
    function exchangeThreshold() external view returns (uint256);
    function previewMint(uint256 shares) external view returns (uint256 assets);
    function maxDeposit(address receiver) external view returns (uint256);
    function mint(uint256 shares, address receiver) external returns (uint256 assets);
    function compoundRewards(uint256 amount, address[] calldata rewardTokens, address receiver) external;
}

