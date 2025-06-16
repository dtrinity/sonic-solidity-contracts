// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDStableConversionAdapter} from "../interfaces/IDStableConversionAdapter.sol";

/**
 * @title PositiveSlippageAdapter
 * @notice A testing stub that wraps an existing IDStableConversionAdapter but adds a configurable
 *         positive slippage (+10 %) on `convertFromVaultAsset`. All other view/convert functions
 *         simply delegate to the underlying adapter so that state and accounting remain realistic
 *         enough for unit‐tests.
 * @dev The contract purposefully lives only in the `mocks` folder and MUST NOT be deployed to
 *      production environments.
 */
contract PositiveSlippageAdapter is IDStableConversionAdapter {
    using SafeERC20 for IERC20;

    IDStableConversionAdapter public immutable underlying; // Real strategy adapter being wrapped
    IERC20 public immutable dStable; // dStable token handled by the system

    /// @param _underlying The real adapter instance to delegate most logic to
    /// @param _dStable    Address of the core dStable token (used for top-up bonus transfers)
    constructor(address _underlying, address _dStable) {
        require(
            _underlying != address(0) && _dStable != address(0),
            "Zero address"
        );
        underlying = IDStableConversionAdapter(_underlying);
        dStable = IERC20(_dStable);
    }

    /*//////////////////////////////////////////////////////////////
                                View functions
    //////////////////////////////////////////////////////////////*/

    function vaultAsset() external view override returns (address) {
        return underlying.vaultAsset();
    }

    function previewConvertToVaultAsset(
        uint256 dStableAmount
    )
        external
        view
        override
        returns (address vaultAssetOut, uint256 vaultAssetAmount)
    {
        return underlying.previewConvertToVaultAsset(dStableAmount);
    }

    function previewConvertFromVaultAsset(
        uint256 vaultAssetAmount
    ) external view override returns (uint256 dStableAmount) {
        // Same as underlying (no slippage in preview!)
        return underlying.previewConvertFromVaultAsset(vaultAssetAmount);
    }

    function assetValueInDStable(
        address vaultAssetToken,
        uint256 vaultAssetAmount
    ) external view override returns (uint256 value) {
        return
            underlying.assetValueInDStable(vaultAssetToken, vaultAssetAmount);
    }

    /*//////////////////////////////////////////////////////////////
                              Mutating functions
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IDStableConversionAdapter
    function convertToVaultAsset(
        uint256 dStableAmount
    )
        external
        override
        returns (address vaultAssetToken, uint256 vaultAssetAmount)
    {
        // Pull the dStable from the caller (router)
        dStable.safeTransferFrom(msg.sender, address(this), dStableAmount);
        dStable.approve(address(underlying), dStableAmount);
        // Delegate actual conversion logic
        (vaultAssetToken, vaultAssetAmount) = underlying.convertToVaultAsset(
            dStableAmount
        );
        return (vaultAssetToken, vaultAssetAmount);
    }

    /// @inheritdoc IDStableConversionAdapter
    function convertFromVaultAsset(
        uint256 vaultAssetAmount
    ) external override returns (uint256 dStableReturned) {
        address _vaultAsset = underlying.vaultAsset();
        IERC20 vaultAsset = IERC20(_vaultAsset);

        // Pull the vaultAsset from caller (router)
        vaultAsset.safeTransferFrom(
            msg.sender,
            address(this),
            vaultAssetAmount
        );
        vaultAsset.approve(address(underlying), vaultAssetAmount);

        // Perform underlying conversion first
        uint256 baseReceived = underlying.convertFromVaultAsset(
            vaultAssetAmount
        );

        // Calculate bonus (+10 %) and ensure availability
        uint256 bonus = baseReceived / 10; // 10 % extra
        uint256 available = dStable.balanceOf(address(this));
        if (bonus > available) {
            bonus = available; // Cap to available liquidity so we never revert for OOG
        }

        dStableReturned = baseReceived + bonus;
        // Forward total amount to caller (router)
        dStable.safeTransfer(msg.sender, dStableReturned);
    }
}
