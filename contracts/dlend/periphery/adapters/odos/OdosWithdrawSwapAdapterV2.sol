// SPDX-License-Identifier: AGPL-3.0
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import { DataTypes } from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";
import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { BaseOdosSellAdapterV2 } from "./BaseOdosSellAdapterV2.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { ReentrancyGuard } from "../../dependencies/openzeppelin/ReentrancyGuard.sol";
import { IOdosWithdrawSwapAdapterV2 } from "./interfaces/IOdosWithdrawSwapAdapterV2.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title OdosWithdrawSwapAdapterV2
 * @notice Adapter to withdraw and swap using Odos with PT token support
 * @dev Supports regular tokens and PT tokens through composed Pendle + Odos swaps
 */
contract OdosWithdrawSwapAdapterV2 is BaseOdosSellAdapterV2, ReentrancyGuard, IOdosWithdrawSwapAdapterV2 {
    using SafeERC20 for IERC20;

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 swapRouter,
        address pendleRouter,
        address owner
    ) BaseOdosSellAdapterV2(addressesProvider, pool, swapRouter, pendleRouter) {
        transferOwnership(owner);
    }

    /**
     * @dev Implementation of the reserve data getter from the base adapter
     * @param asset The address of the asset
     * @return The address of the vToken, sToken and aToken
     */
    function _getReserveData(address asset) internal view override returns (address, address, address) {
        DataTypes.ReserveData memory reserveData = POOL.getReserveData(asset);
        return (reserveData.variableDebtTokenAddress, reserveData.stableDebtTokenAddress, reserveData.aTokenAddress);
    }

    /**
     * @dev Implementation of the supply function from the base adapter
     * @param asset The address of the asset to be supplied
     * @param amount The amount of the asset to be supplied
     * @param to The address receiving the aTokens
     * @param referralCode The referral code to pass to Aave
     */
    function _supply(address asset, uint256 amount, address to, uint16 referralCode) internal override {
        POOL.supply(asset, amount, to, referralCode);
    }

    /// @inheritdoc IOdosWithdrawSwapAdapterV2
    function withdrawAndSwap(
        WithdrawSwapParamsV2 memory withdrawSwapParams,
        PermitInput memory permitInput
    ) external nonReentrant {
        (, , address aToken) = _getReserveData(withdrawSwapParams.oldAsset);
        if (withdrawSwapParams.allBalanceOffset != 0) {
            uint256 balance = IERC20(aToken).balanceOf(withdrawSwapParams.user);
            withdrawSwapParams.oldAssetAmount = balance;
        }

        // pulls liquidity asset from the user and withdraw
        _pullATokenAndWithdraw(
            withdrawSwapParams.oldAsset,
            withdrawSwapParams.user,
            withdrawSwapParams.oldAssetAmount,
            permitInput
        );

        // Use adaptive swap which handles both regular and PT token swaps intelligently
        uint256 amountReceived = _executeAdaptiveSwap(
            IERC20Detailed(withdrawSwapParams.oldAsset),
            IERC20Detailed(withdrawSwapParams.newAsset),
            withdrawSwapParams.oldAssetAmount,
            withdrawSwapParams.minAmountToReceive,
            withdrawSwapParams.swapData
        );

        // transfer new asset to the user
        IERC20(withdrawSwapParams.newAsset).safeTransfer(withdrawSwapParams.user, amountReceived);
    }
}
