// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDStableConversionAdapter } from "../vaults/dstake/interfaces/IDStableConversionAdapter.sol";
import { MockERC4626Simple } from "./MockERC4626Simple.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockAdapterPositiveSlippage is IDStableConversionAdapter {
    using SafeERC20 for IERC20;

    address public immutable dStable;
    MockERC4626Simple public immutable vaultToken;
    address public immutable collateralVault;

    constructor(address _dStable, address _collateralVault) {
        dStable = _dStable;
        collateralVault = _collateralVault;
        vaultToken = new MockERC4626Simple(IERC20(_dStable));
    }

    function convertToVaultAsset(
        uint256 dStableAmount
    ) external override returns (address _vaultAsset, uint256 vaultAssetAmount) {
        IERC20(dStable).transferFrom(msg.sender, address(this), dStableAmount);
        IERC20(dStable).forceApprove(address(vaultToken), dStableAmount);
        vaultAssetAmount = vaultToken.deposit(dStableAmount, collateralVault);
        return (address(vaultToken), vaultAssetAmount);
    }

    function convertFromVaultAsset(uint256 vaultAssetAmount) external override returns (uint256 dStableAmount) {
        // pull vault tokens
        IERC20(address(vaultToken)).transferFrom(msg.sender, address(this), vaultAssetAmount);
        IERC20(address(vaultToken)).forceApprove(address(vaultToken), vaultAssetAmount);
        dStableAmount = vaultToken.redeem(vaultAssetAmount, msg.sender, address(this));
    }

    function previewConvertToVaultAsset(
        uint256 dStableAmount
    ) external view override returns (address _vaultAsset, uint256 vaultAssetAmount) {
        return (address(vaultToken), dStableAmount);
    }

    function previewConvertFromVaultAsset(
        uint256 vaultAssetAmount
    ) external view override returns (uint256 dStableAmount) {
        return vaultToken.previewRedeem(vaultAssetAmount);
    }

    function assetValueInDStable(
        address _vaultAsset,
        uint256 vaultAssetAmount
    ) external view override returns (uint256 dStableValue) {
        require(_vaultAsset == address(vaultToken), "Wrong asset");
        return vaultToken.previewRedeem(vaultAssetAmount);
    }

    function vaultAsset() external view override returns (address) {
        return address(vaultToken);
    }
}
