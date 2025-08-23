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
import { BaseOdosSellAdapter } from "./BaseOdosSellAdapter.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { ReentrancyGuard } from "../../dependencies/openzeppelin/ReentrancyGuard.sol";
import { IOdosWithdrawSwapAdapter } from "./interfaces/IOdosWithdrawSwapAdapter.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title OdosWithdrawSwapAdapter
 * @notice Adapter to swap then withdraw using Odos
 */
contract OdosWithdrawSwapAdapter is BaseOdosSellAdapter, ReentrancyGuard, IOdosWithdrawSwapAdapter {
    using SafeERC20 for IERC20;

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 swapRouter,
        address owner
    ) BaseOdosSellAdapter(addressesProvider, pool, swapRouter) {
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

    /// @inheritdoc IOdosWithdrawSwapAdapter
    function withdrawAndSwap(
        WithdrawSwapParams memory withdrawSwapParams,
        PermitInput memory permitInput
    ) external nonReentrant {
        // pulls liquidity asset from the user and withdraw
        _pullATokenAndWithdraw(
            withdrawSwapParams.oldAsset,
            withdrawSwapParams.user,
            withdrawSwapParams.oldAssetAmount,
            permitInput
        );

        // sell(exact in) withdrawn asset from Aave Pool to new asset
        uint256 amountReceived = _sellOnOdos(
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
