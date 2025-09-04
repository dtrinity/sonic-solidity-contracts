// SPDX-License-Identifier: MIT
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

import "./CollateralVault.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title CollateralHolderVault
 * @notice Implementation of CollateralVault for only holding tokens
 */
contract CollateralHolderVault is CollateralVault {
    using SafeERC20 for IERC20Metadata;
    using EnumerableSet for EnumerableSet.AddressSet;

    /* Errors */
    error CannotWithdrawMoreValueThanDeposited(uint256 requestedAmount, uint256 maxAmount);
    error ToCollateralAmountBelowMin(uint256 toCollateralAmount, uint256 toMinCollateral);

    constructor(IPriceOracleGetter oracle) CollateralVault(oracle) {}

    /**
     * @notice Exchanges one type of collateral for another
     * @param fromCollateralAmount Amount of collateral to exchange from
     * @param fromCollateral Address of the source collateral token
     * @param toCollateralAmount Amount of collateral to receive
     * @param toCollateral Address of the destination collateral token
     * @dev Ensures the exchange maintains equivalent value using oracle prices
     */
    function exchangeCollateral(
        uint256 fromCollateralAmount,
        address fromCollateral,
        uint256 toCollateralAmount,
        address toCollateral
    ) public onlyRole(COLLATERAL_STRATEGY_ROLE) {
        // The collateral being received by the vault (fromCollateral) must still be supported
        // `toCollateral` may have been de-listed (disallowed) in order to let the vault gradually
        // swap it out, so we intentionally do NOT enforce the check on `toCollateral`.
        require(_supportedCollaterals.contains(fromCollateral), "Unsupported collateral");
        uint256 maxAmount = maxExchangeAmount(fromCollateralAmount, fromCollateral, toCollateral);
        if (toCollateralAmount > maxAmount) {
            revert CannotWithdrawMoreValueThanDeposited(toCollateralAmount, maxAmount);
        }

        IERC20Metadata(fromCollateral).safeTransferFrom(msg.sender, address(this), fromCollateralAmount);
        IERC20Metadata(toCollateral).safeTransfer(msg.sender, toCollateralAmount);
    }

    /**
     * @notice Exchanges collateral for the maximum possible amount of another collateral
     * @param fromCollateralAmount Amount of collateral to exchange from
     * @param fromCollateral Address of the source collateral token
     * @param toCollateral Address of the destination collateral token
     * @param toMinCollateral Minimum amount of destination collateral to receive
     * @dev Calculates and executes the maximum possible exchange while respecting minimum amount
     */
    function exchangeMaxCollateral(
        uint256 fromCollateralAmount,
        address fromCollateral,
        address toCollateral,
        uint256 toMinCollateral
    ) public onlyRole(COLLATERAL_STRATEGY_ROLE) {
        uint256 toCollateralAmount = maxExchangeAmount(fromCollateralAmount, fromCollateral, toCollateral);
        if (toCollateralAmount < toMinCollateral) {
            revert ToCollateralAmountBelowMin(toCollateralAmount, toMinCollateral);
        }
        exchangeCollateral(fromCollateralAmount, fromCollateral, toCollateralAmount, toCollateral);
    }

    /**
     * @notice Calculates the maximum amount of destination collateral that can be received
     * @param fromCollateralAmount Amount of source collateral
     * @param fromCollateral Address of the source collateral token
     * @param toCollateral Address of the destination collateral token
     * @return toCollateralAmount The maximum amount of destination collateral that can be received
     * @dev Uses oracle prices and token decimals to maintain equivalent value
     */
    function maxExchangeAmount(
        uint256 fromCollateralAmount,
        address fromCollateral,
        address toCollateral
    ) public view returns (uint256 toCollateralAmount) {
        uint256 fromCollateralPrice = oracle.getAssetPrice(fromCollateral);
        uint256 toCollateralPrice = oracle.getAssetPrice(toCollateral);

        uint8 fromCollateralDecimals = IERC20Metadata(fromCollateral).decimals();
        uint8 toCollateralDecimals = IERC20Metadata(toCollateral).decimals();

        uint256 fromCollateralBaseValue = Math.mulDiv(
            fromCollateralPrice,
            fromCollateralAmount,
            10 ** fromCollateralDecimals
        );

        toCollateralAmount = Math.mulDiv(fromCollateralBaseValue, 10 ** toCollateralDecimals, toCollateralPrice);

        return toCollateralAmount;
    }

    /**
     * @notice Calculates the total value of all collateral in the vault
     * @return baseValue The total value of all collateral in base
     */
    function totalValue() public view override returns (uint256 baseValue) {
        return _totalValueOfSupportedCollaterals();
    }
}
