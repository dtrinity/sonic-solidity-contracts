// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { MockERC4626Simple } from "./MockERC4626Simple.sol";
import { IDStableConversionAdapter } from "../vaults/dstake/interfaces/IDStableConversionAdapter.sol";

/**
 * @title MockAdapterSmallDepositRevert
 * @notice Test-only adapter that intentionally reverts when `convertToVaultAsset`
 *         is called with < 2 wei of dSTABLE.  Used to reproduce the dStakeRouter
 *         surplus-rounding DoS in unit tests.
 */
contract MockAdapterSmallDepositRevert is IDStableConversionAdapter {
    // --- Errors ---
    error ZeroAddress();
    error DepositTooSmall(uint256 amount);

    // --- Constants ---
    uint256 private constant MIN_DEPOSIT = 2; // Wei of dSTABLE required for a successful deposit

    // --- State ---
    IERC20 public immutable dStable; // underlying stablecoin
    MockERC4626Simple public immutable vaultAssetToken; // mock wrapped asset
    address public immutable collateralVault; // DStakeCollateralVault address (receiver of minted shares)

    constructor(address _dStable, address _collateralVault) {
        if (_dStable == address(0) || _collateralVault == address(0)) {
            revert ZeroAddress();
        }
        dStable = IERC20(_dStable);
        collateralVault = _collateralVault;
        // Deploy the simple ERC4626 vault token (1:1 deposit)
        vaultAssetToken = new MockERC4626Simple(IERC20(_dStable));
    }

    // ---------------- IDStableConversionAdapter ----------------

    function convertToVaultAsset(
        uint256 dStableAmount
    ) external override returns (address _vaultAsset, uint256 vaultAssetAmount) {
        if (dStableAmount < MIN_DEPOSIT) revert DepositTooSmall(dStableAmount);

        // Pull dStable from caller (Router)
        dStable.transferFrom(msg.sender, address(this), dStableAmount);

        // Deposit dStable into the ERC4626 mock, minting shares to the vault
        IERC20(address(dStable)).approve(address(vaultAssetToken), dStableAmount);
        vaultAssetToken.deposit(dStableAmount, collateralVault);

        _vaultAsset = address(vaultAssetToken);
        vaultAssetAmount = dStableAmount;
    }

    function convertFromVaultAsset(uint256 vaultAssetAmount) external override returns (uint256 dStableAmount) {
        // Pull shares from caller (Router)
        IERC20(address(vaultAssetToken)).transferFrom(msg.sender, address(this), vaultAssetAmount);

        // Redeem shares for dStable, sending the dStable directly to the router (msg.sender)
        dStableAmount = vaultAssetToken.redeem(vaultAssetAmount, msg.sender, address(this));
    }

    function previewConvertToVaultAsset(
        uint256 dStableAmount
    ) external view override returns (address _vaultAsset, uint256 vaultAssetAmount) {
        _vaultAsset = address(vaultAssetToken);
        vaultAssetAmount = dStableAmount;
    }

    function previewConvertFromVaultAsset(
        uint256 vaultAssetAmount
    ) external pure override returns (uint256 dStableAmount) {
        return (vaultAssetAmount * 11000) / 10000; // 1.1x like MockERC4626Simple
    }

    function assetValueInDStable(
        address _vaultAsset,
        uint256 vaultAssetAmount
    ) external pure override returns (uint256 dStableValue) {
        require(_vaultAsset == address(0) || _vaultAsset != address(0), "NOP"); // dummy check to silence linter
        return (vaultAssetAmount * 11000) / 10000;
    }

    function vaultAsset() external view override returns (address) {
        return address(vaultAssetToken);
    }
}
