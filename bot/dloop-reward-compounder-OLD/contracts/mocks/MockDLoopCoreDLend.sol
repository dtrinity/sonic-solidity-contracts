// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MockERC20 } from "./MockERC20.sol";

contract MockDLoopCoreDLend {
    MockERC20 public immutable collateral;
    MockERC20 public immutable dusd;
    MockERC20 public immutable shares;

    uint256 public exchangeThresholdValue;
    uint256 public previewMintAssets; // assets needed to mint S
    uint256 public kBorrowedOnMint;   // dUSD credited on mint
    uint256 public netRewardOnCompound; // dUSD reward after fee
    bool public depositDisabled;

    constructor(address _collateral, address _dusd, address _shares) {
        collateral = MockERC20(_collateral);
        dusd = MockERC20(_dusd);
        shares = MockERC20(_shares);
        exchangeThresholdValue = 1e18;
        previewMintAssets = 300e18;
        kBorrowedOnMint = 200e18;
        netRewardOnCompound = 105e18;
    }

    function setParams(uint256 thr, uint256 pm, uint256 k, uint256 reward, bool disabled) external {
        exchangeThresholdValue = thr; previewMintAssets = pm; kBorrowedOnMint = k; netRewardOnCompound = reward; depositDisabled = disabled;
    }

    function exchangeThreshold() external view returns (uint256) { return exchangeThresholdValue; }
    function previewMint(uint256) external view returns (uint256) { return previewMintAssets; }
    function maxDeposit(address) external view returns (uint256) { return depositDisabled ? 0 : type(uint256).max; }

    function mint(uint256 sharesAmount, address receiver) external returns (uint256 assets) {
        // pull collateral from caller
        require(collateral.transferFrom(msg.sender, address(this), previewMintAssets), "pull collat");
        // mint shares to receiver
        shares.mint(receiver, sharesAmount);
        // send dUSD borrow K to receiver
        dusd.mint(receiver, kBorrowedOnMint);
        return previewMintAssets;
    }

    function compoundRewards(uint256 amount, address[] calldata, address receiver) external {
        // burn shares from caller (simulate: require allowance and balance)
        // For simplicity in mock, just ignore burn and transfer netReward to receiver
        dusd.mint(receiver, netRewardOnCompound);
    }
}

