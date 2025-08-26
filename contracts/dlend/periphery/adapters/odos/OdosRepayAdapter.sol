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
import { IOdosRepayAdapter } from "./interfaces/IOdosRepayAdapter.sol";
import { BaseOdosSellAdapter } from "./BaseOdosSellAdapter.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { IERC20WithPermit } from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";

/**
 * @title OdosRepayAdapter
 * @notice Implements the logic for repaying a debt using a different asset as source
 */
contract OdosRepayAdapter is BaseOdosSellAdapter, IOdosRepayAdapter {
    using SafeERC20 for IERC20;
    using SafeERC20 for IERC20WithPermit;

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _swapRouter,
        address owner
    ) BaseOdosSellAdapter(addressesProvider, pool, _swapRouter) {
        transferOwnership(owner);
    }

    /**
     * @dev Swaps collateral for another asset with Odos, and uses that asset to repay a debt.
     * @param repayParams The parameters of the repay
     * @param permitInput The parameters of the permit signature, to approve collateral aToken
     * @return the amount repaid
     */
    function swapAndRepay(RepayParams memory repayParams, PermitInput memory permitInput) external returns (uint256) {
        address collateralAsset = repayParams.collateralAsset;
        address debtAsset = repayParams.debtAsset;

        // The swapAndRepay will pull the tokens from the user aToken with approve() or permit()
        uint256 collateralATokenAmount = _pullATokenAndWithdraw(
            collateralAsset,
            msg.sender,
            repayParams.collateralAmount,
            permitInput
        );

        // Swap collateral to get the debt asset
        uint256 amountOut = _sellOnOdos(
            IERC20Detailed(collateralAsset),
            IERC20Detailed(debtAsset),
            collateralATokenAmount,
            repayParams.minAmountToReceive,
            repayParams.swapData
        );

        // Check if the swap provides the necessary repay amount
        if (amountOut < repayParams.repayAmount) {
            revert InsufficientAmountToRepay(amountOut, repayParams.repayAmount);
        }

        // Check and renew allowance if necessary
        _conditionalRenewAllowance(debtAsset, amountOut);

        // Repay the debt to the POOL
        POOL.repay(debtAsset, repayParams.repayAmount, repayParams.rateMode, repayParams.user);

        // Send remaining debt asset to the msg.sender
        uint256 remainingBalance = IERC20Detailed(debtAsset).balanceOf(address(this));
        if (remainingBalance > 0) {
            IERC20(debtAsset).safeTransfer(msg.sender, remainingBalance);
        }

        return amountOut;
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
}
