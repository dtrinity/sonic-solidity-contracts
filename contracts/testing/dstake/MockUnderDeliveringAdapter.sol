// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IDStableConversionAdapter } from "contracts/vaults/dstake/interfaces/IDStableConversionAdapter.sol";
import { IMintableERC20 } from "contracts/common/IMintableERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockUnderDeliveringAdapter
 * @notice Test adapter that intentionally under-delivers vault asset shares compared to the preview result.
 *         Used only in Hardhat tests to verify router slippage protections.
 */
contract MockUnderDeliveringAdapter is IDStableConversionAdapter {
    using SafeERC20 for IERC20;

    address public immutable dStable;
    address public immutable collateralVault;
    IMintableERC20 public immutable vaultAssetToken;

    uint256 public immutable factorBps; // e.g. 9000 => mints 90% of preview amount

    error InvalidFactor();

    constructor(address _dStable, address _collateralVault, IMintableERC20 _vaultAssetToken, uint256 _factorBps) {
        if (_factorBps == 0 || _factorBps > 10_000) revert InvalidFactor();
        dStable = _dStable;
        collateralVault = _collateralVault;
        vaultAssetToken = _vaultAssetToken;
        factorBps = _factorBps;
    }

    // ---------------- IDStableConversionAdapter ----------------

    function convertToVaultAsset(uint256 dStableAmount) external override returns (address, uint256) {
        // Pull dStable from caller
        IERC20(dStable).safeTransferFrom(msg.sender, address(this), dStableAmount);

        uint256 shares = (dStableAmount * factorBps) / 10_000;

        // Mint shares directly to collateral vault (simulating under-delivery)
        vaultAssetToken.mint(collateralVault, shares);

        return (address(vaultAssetToken), shares);
    }

    function convertFromVaultAsset(uint256 vaultAssetAmount) external pure override returns (uint256) {
        // Not needed for this mock; revert to prevent unexpected use
        revert("Not implemented");
    }

    function previewConvertToVaultAsset(uint256 dStableAmount) external view override returns (address, uint256) {
        // Preview assumes 1:1 conversion
        return (address(vaultAssetToken), dStableAmount);
    }

    function previewConvertFromVaultAsset(uint256 vaultAssetAmount) external pure override returns (uint256) {
        return vaultAssetAmount; // 1:1
    }

    function assetValueInDStable(
        address /*vaultAsset*/,
        uint256 vaultAssetAmount
    ) external pure override returns (uint256) {
        return vaultAssetAmount;
    }

    function vaultAsset() external view override returns (address) {
        return address(vaultAssetToken);
    }
}
