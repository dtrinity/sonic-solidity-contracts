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

import {IBaseOdosAdapter} from "./IBaseOdosAdapter.sol";

/**
 * @title IOdosDebtSwapAdapter
 * @notice Interface for the OdosDebtSwapAdapter
 */
interface IOdosDebtSwapAdapter is IBaseOdosAdapter {
    /* Structs */
    /**
     * @dev Struct to hold credit delegation data
     * @param debtToken The address of the debt token
     * @param value The amount of tokens to delegate
     * @param deadline The deadline for the delegation
     * @param v The v parameter of the signature
     * @param r The r parameter of the signature
     * @param s The s parameter of the signature
     */
    struct CreditDelegationInput {
        address debtToken;
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /**
     * @dev Struct to hold the debt swap parameters
     * @param debtAsset The address of the debt asset
     * @param debtRepayAmount The amount of debt to repay
     * @param debtRateMode The rate mode of the debt
     * @param newDebtAsset The address of the new debt asset
     * @param maxNewDebtAmount The maximum amount of new debt
     * @param extraCollateralAsset The address of the extra collateral asset
     * @param extraCollateralAmount The amount of extra collateral
     * @param swapData The encoded swap data for Odos
     */
    struct DebtSwapParams {
        address debtAsset;
        uint256 debtRepayAmount;
        uint256 debtRateMode;
        address newDebtAsset;
        uint256 maxNewDebtAmount;
        address extraCollateralAsset;
        uint256 extraCollateralAmount;
        bytes swapData;
    }

    /**
     * @dev Struct to hold flash loan parameters
     * @param debtAsset The address of the debt asset
     * @param debtRepayAmount The amount of debt to repay
     * @param debtRateMode The rate mode of the debt
     * @param nestedFlashloanDebtAsset The address of the nested flashloan debt asset
     * @param nestedFlashloanDebtAmount The amount of nested flashloan debt
     * @param user The address of the user
     * @param swapData The encoded swap data for Odos
     */
    struct FlashParams {
        address debtAsset;
        uint256 debtRepayAmount;
        uint256 debtRateMode;
        address nestedFlashloanDebtAsset;
        uint256 nestedFlashloanDebtAmount;
        address user;
        bytes swapData;
    }

    /**
     * @dev Swaps one type of debt to another
     * @param debtSwapParams The debt swap parameters
     * @param creditDelegationPermit The credit delegation permit
     * @param collateralATokenPermit The collateral aToken permit
     */
    function swapDebt(
        DebtSwapParams memory debtSwapParams,
        CreditDelegationInput memory creditDelegationPermit,
        PermitInput memory collateralATokenPermit
    ) external;
}
