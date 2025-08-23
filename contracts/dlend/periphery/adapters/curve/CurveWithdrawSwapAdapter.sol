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
import { BaseCurveSellAdapter } from "contracts/dlend/periphery/adapters/curve/BaseCurveSellAdapter.sol";
import { SafeERC20 } from "contracts/dlend/periphery/treasury/libs/SafeERC20.sol";
import { ReentrancyGuard } from "contracts/dlend/periphery/treasury/libs/ReentrancyGuard.sol";
import { ICurveWithdrawSwapAdapter } from "contracts/dlend/periphery/adapters/curve/interfaces/ICurveWithdrawSwapAdapter.sol";
import { ICurveRouterNgPoolsOnlyV1 } from "contracts/dlend/periphery/adapters/curve/interfaces/ICurveRouterNgPoolsOnlyV1.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title CurveWithdrawSwapAdapter
 * @notice Adapter to swap then withdraw using Curve
 */
contract CurveWithdrawSwapAdapter is BaseCurveSellAdapter, ReentrancyGuard, ICurveWithdrawSwapAdapter {
    using SafeERC20 for IERC20;

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        ICurveRouterNgPoolsOnlyV1 swapRouter,
        address owner
    ) BaseCurveSellAdapter(addressesProvider, pool, swapRouter) {
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

    /// @inheritdoc ICurveWithdrawSwapAdapter
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
        uint256 amountReceived = _sellOnCurve(
            IERC20Detailed(withdrawSwapParams.oldAsset),
            IERC20Detailed(withdrawSwapParams.newAsset),
            withdrawSwapParams.oldAssetAmount,
            withdrawSwapParams.minAmountToReceive,
            withdrawSwapParams.route,
            withdrawSwapParams.swapParams
        );

        // transfer new asset to the user
        IERC20(withdrawSwapParams.newAsset).safeTransfer(withdrawSwapParams.user, amountReceived);
    }
}
