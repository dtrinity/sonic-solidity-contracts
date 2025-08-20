// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDLoopCoreDLend {
    // Minimal ERC4626-like methods used
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function exchangeThreshold() external view returns (uint256);
    function maxDeposit(address receiver) external view returns (uint256);

    // Reward compounding entry
    function compoundRewards(
        uint256 amount,
        address[] calldata rewardTokens,
        address receiver
    ) external;
}

