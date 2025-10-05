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

import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IPriceOracleGetter } from "contracts/dlend/core/interfaces/IPriceOracleGetter.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { IBaseOdosAdapterV2 } from "./interfaces/IBaseOdosAdapterV2.sol";

/**
 * @title OracleValidation
 * @notice Shared oracle price validation logic for V2 adapters
 * @dev Provides common oracle validation functions to eliminate code duplication
 */
abstract contract OracleValidation {
    /// @notice Oracle price deviation tolerance in basis points (500 = 5%)
    uint256 public constant ORACLE_PRICE_TOLERANCE_BPS = 500;

    // Custom errors are defined in IBaseOdosAdapterV2 interface

    /**
     * @dev Get the addresses provider - to be implemented by inheriting contracts
     * @return The addresses provider instance
     */
    function _getAddressesProvider() internal view virtual returns (IPoolAddressesProvider);

    /**
     * @dev Validates swap amounts against oracle prices for exact output swaps
     * @param tokenIn The input token address
     * @param tokenOut The output token address
     * @param maxAmountIn The maximum input amount willing to spend
     * @param exactAmountOut The exact output amount required
     */
    function _validateOraclePriceExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 maxAmountIn,
        uint256 exactAmountOut
    ) internal view {
        // Get token decimals for proper calculation
        uint256 decimalsIn = IERC20Detailed(tokenIn).decimals();
        uint256 decimalsOut = IERC20Detailed(tokenOut).decimals();

        // Get oracle prices
        IPriceOracleGetter oracle = IPriceOracleGetter(_getAddressesProvider().getPriceOracle());
        uint256 priceIn = oracle.getAssetPrice(tokenIn);
        uint256 priceOut = oracle.getAssetPrice(tokenOut);

        // Prevent swaps when oracle prices are not configured (zero prices)
        if (priceIn == 0 || priceOut == 0) {
            revert IBaseOdosAdapterV2.OraclePriceDeviationExceeded(tokenIn, tokenOut, 0, 0, type(uint256).max);
        }

        // Calculate expected input amount using oracle prices
        // expectedIn = (exactAmountOut * priceOut * 10^decimalsIn) / (priceIn * 10^decimalsOut)
        uint256 expectedAmountIn = (exactAmountOut * priceOut * (10 ** decimalsIn)) / (priceIn * (10 ** decimalsOut));

        // For exact output, we validate that maxAmountIn isn't excessively higher than expectedAmountIn
        // Calculate deviation: (maxAmountIn - expectedAmountIn) / expectedAmountIn * 10000 (in BPS)
        if (maxAmountIn > expectedAmountIn) {
            uint256 deviationBps = ((maxAmountIn - expectedAmountIn) * 10000) / expectedAmountIn;

            // Revert if user is willing to pay too much more than oracle suggests
            if (deviationBps > ORACLE_PRICE_TOLERANCE_BPS) {
                revert IBaseOdosAdapterV2.OraclePriceDeviationExceeded(
                    tokenIn,
                    tokenOut,
                    expectedAmountIn,
                    maxAmountIn,
                    deviationBps
                );
            }
        }
        // Note: We don't validate if maxAmountIn < expectedAmountIn as the user might have better pricing
    }

    /**
     * @dev Validates swap amounts against oracle prices for exact input swaps
     * @param tokenIn The input token address
     * @param tokenOut The output token address
     * @param amountIn The input amount for exact input swaps
     * @param minAmountOut The minimum output amount expected
     */
    function _validateOraclePriceExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal view {
        // Get token decimals for proper calculation
        uint256 decimalsIn = IERC20Detailed(tokenIn).decimals();
        uint256 decimalsOut = IERC20Detailed(tokenOut).decimals();

        // Get oracle prices
        IPriceOracleGetter oracle = IPriceOracleGetter(_getAddressesProvider().getPriceOracle());
        uint256 priceIn = oracle.getAssetPrice(tokenIn);
        uint256 priceOut = oracle.getAssetPrice(tokenOut);

        // Prevent swaps when oracle prices are not configured (zero prices)
        if (priceIn == 0 || priceOut == 0) {
            revert IBaseOdosAdapterV2.OraclePriceDeviationExceeded(tokenIn, tokenOut, 0, 0, type(uint256).max);
        }

        // Calculate expected output amount using oracle prices
        // expectedOut = (amountIn * priceIn * 10^decimalsOut) / (priceOut * 10^decimalsIn)
        uint256 expectedAmountOut = (amountIn * priceIn * (10 ** decimalsOut)) / (priceOut * (10 ** decimalsIn));

        // Calculate deviation: |expected - actual| / expected * 10000 (in BPS)
        uint256 deviationBps;
        if (expectedAmountOut > minAmountOut) {
            deviationBps = ((expectedAmountOut - minAmountOut) * 10000) / expectedAmountOut;
        } else {
            deviationBps = ((minAmountOut - expectedAmountOut) * 10000) / expectedAmountOut;
        }

        // Revert if deviation exceeds tolerance
        if (deviationBps > ORACLE_PRICE_TOLERANCE_BPS) {
            revert IBaseOdosAdapterV2.OraclePriceDeviationExceeded(
                tokenIn,
                tokenOut,
                expectedAmountOut,
                minAmountOut,
                deviationBps
            );
        }
    }
}
