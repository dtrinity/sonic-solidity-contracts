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

import { IBaseOdosAdapterV2 } from "./IBaseOdosAdapterV2.sol";

/**
 * @title IOdosDebtSwapAdapterV2
 * @notice Interface for the OdosDebtSwapAdapterV2 with PT token support
 * @dev V2 interface with PT token functionality via composed swaps
 */
interface IOdosDebtSwapAdapterV2 is IBaseOdosAdapterV2 {
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
     * @dev Enhanced debt swap parameters for V2 with PT support
     * @param debtAsset The address of the debt asset (can be PT token)
     * @param debtRepayAmount The amount of debt to repay
     * @param debtRateMode The rate mode of the debt
     * @param newDebtAsset The address of the new debt asset (can be PT token)
     * @param maxNewDebtAmount The maximum amount of new debt
     * @param extraCollateralAsset The address of the extra collateral asset
     * @param extraCollateralAmount The amount of extra collateral
     * @param swapData The swap data (either regular Odos calldata or encoded PTSwapDataV2)
     * @param allBalanceOffset offset to all balance of the user
     */
    struct DebtSwapParamsV2 {
        address debtAsset;
        uint256 debtRepayAmount;
        uint256 debtRateMode;
        address newDebtAsset;
        uint256 maxNewDebtAmount;
        address extraCollateralAsset;
        uint256 extraCollateralAmount;
        bytes swapData;
        uint256 allBalanceOffset;
    }

    /**
     * @dev Enhanced flash loan parameters for V2 with PT support
     * @param debtAsset The address of the debt asset
     * @param debtRepayAmount The amount of debt to repay
     * @param debtRateMode The rate mode of the debt
     * @param nestedFlashloanDebtAsset The address of the nested flashloan debt asset
     * @param nestedFlashloanDebtAmount The amount of nested flashloan debt
     * @param user The address of the user
     * @param swapData The swap data (either regular Odos calldata or encoded PTSwapDataV2)
     * @param allBalanceOffset offset to all balance of the user
     */
    struct FlashParamsV2 {
        address debtAsset;
        uint256 debtRepayAmount;
        uint256 debtRateMode;
        address nestedFlashloanDebtAsset;
        uint256 nestedFlashloanDebtAmount;
        address user;
        bytes swapData;
        uint256 allBalanceOffset;
    }

    /**
     * @dev Swaps one type of debt to another with PT token support
     * @param debtSwapParams The enhanced debt swap parameters
     * @param creditDelegationPermit The credit delegation permit
     * @param collateralATokenPermit The collateral aToken permit
     */
    function swapDebt(
        DebtSwapParamsV2 memory debtSwapParams,
        CreditDelegationInput memory creditDelegationPermit,
        PermitInput memory collateralATokenPermit
    ) external;
}
