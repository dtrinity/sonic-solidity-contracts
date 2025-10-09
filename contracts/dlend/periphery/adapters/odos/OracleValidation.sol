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
import { SafeOracleMath } from "./SafeOracleMath.sol";

/**
 * @title OracleValidation
 * @notice Shared oracle price validation logic for V2 adapters
 * @dev Provides common oracle validation functions to eliminate code duplication
 */
abstract contract OracleValidation {
    /// @notice Oracle price deviation tolerance in basis points (default 500 = 5%)
    /// @dev Governance can adjust this based on chain maturity and oracle reliability
    ///      5% is the maximum for exotic chains, should be tightened over time
    uint256 public ORACLE_PRICE_TOLERANCE_BPS = 500;

    /// @notice Maximum allowed tolerance (5%) - governance cannot exceed this
    uint256 public constant MAX_ORACLE_PRICE_TOLERANCE_BPS = 500;

    // Custom errors are defined in IBaseOdosAdapterV2 interface

    /**
     * @dev Get the addresses provider - to be implemented by inheriting contracts
     * @return The addresses provider instance
     */
    function _getAddressesProvider() internal view virtual returns (IPoolAddressesProvider);

    /**
     * @notice Sets the oracle price deviation tolerance
     * @dev Only callable by contract owner (governance)
     * @dev Cannot exceed MAX_ORACLE_PRICE_TOLERANCE_BPS (5%)
     * @dev Should be lowered over time as oracles become more reliable
     * @param newToleranceBps New tolerance in basis points (e.g., 300 = 3%)
     */
    function _setOraclePriceTolerance(uint256 newToleranceBps) internal virtual {
        if (newToleranceBps > MAX_ORACLE_PRICE_TOLERANCE_BPS) {
            revert IBaseOdosAdapterV2.InvalidToleranceBps(newToleranceBps, MAX_ORACLE_PRICE_TOLERANCE_BPS);
        }

        uint256 oldTolerance = ORACLE_PRICE_TOLERANCE_BPS;
        ORACLE_PRICE_TOLERANCE_BPS = newToleranceBps;

        emit OraclePriceToleranceUpdated(oldTolerance, newToleranceBps);
    }

    /**
     * @notice Emitted when oracle price tolerance is updated
     * @param oldTolerance Previous tolerance value in basis points
     * @param newTolerance New tolerance value in basis points
     */
    event OraclePriceToleranceUpdated(uint256 oldTolerance, uint256 newTolerance);

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
    ) internal view virtual {
        // Prevent zero-amount swaps with clear error message
        if (maxAmountIn == 0 || exactAmountOut == 0) {
            revert IBaseOdosAdapterV2.ZeroSwapAmount(tokenIn, tokenOut);
        }

        // Get token decimals for proper calculation
        uint256 decimalsIn = IERC20Detailed(tokenIn).decimals();
        uint256 decimalsOut = IERC20Detailed(tokenOut).decimals();

        // Get oracle prices
        IPriceOracleGetter oracle = IPriceOracleGetter(_getAddressesProvider().getPriceOracle());
        uint256 priceIn = oracle.getAssetPrice(tokenIn);
        uint256 priceOut = oracle.getAssetPrice(tokenOut);

        // Prevent swaps when oracle prices are not configured with clear error message
        if (priceIn == 0) {
            revert IBaseOdosAdapterV2.ZeroOraclePrice(tokenIn);
        }
        if (priceOut == 0) {
            revert IBaseOdosAdapterV2.ZeroOraclePrice(tokenOut);
        }

        // Calculate expected input amount using oracle prices with overflow protection
        // expectedIn = (exactAmountOut * priceOut * 10^decimalsIn) / (priceIn * 10^decimalsOut)
        uint256 expectedAmountIn = SafeOracleMath.calculateExpectedInput(
            exactAmountOut,
            priceIn,
            priceOut,
            decimalsIn,
            decimalsOut
        );

        // Validate deviation in both directions for exact output swaps
        // This prevents both overpaying and underpaying relative to oracle prices
        uint256 deviationBps = SafeOracleMath.calculateDeviationBps(expectedAmountIn, maxAmountIn);

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
    ) internal view virtual {
        // Prevent zero-amount swaps with clear error message
        if (amountIn == 0 || minAmountOut == 0) {
            revert IBaseOdosAdapterV2.ZeroSwapAmount(tokenIn, tokenOut);
        }

        // Get token decimals for proper calculation
        uint256 decimalsIn = IERC20Detailed(tokenIn).decimals();
        uint256 decimalsOut = IERC20Detailed(tokenOut).decimals();

        // Get oracle prices
        IPriceOracleGetter oracle = IPriceOracleGetter(_getAddressesProvider().getPriceOracle());
        uint256 priceIn = oracle.getAssetPrice(tokenIn);
        uint256 priceOut = oracle.getAssetPrice(tokenOut);

        // Prevent swaps when oracle prices are not configured with clear error message
        if (priceIn == 0) {
            revert IBaseOdosAdapterV2.ZeroOraclePrice(tokenIn);
        }
        if (priceOut == 0) {
            revert IBaseOdosAdapterV2.ZeroOraclePrice(tokenOut);
        }

        // Calculate expected output amount using oracle prices with overflow protection
        // expectedOut = (amountIn * priceIn * 10^decimalsOut) / (priceOut * 10^decimalsIn)
        uint256 expectedAmountOut = SafeOracleMath.calculateExpectedOutput(
            amountIn,
            priceIn,
            priceOut,
            decimalsIn,
            decimalsOut
        );

        // Calculate deviation with overflow protection: |expected - actual| / expected * 10000 (in BPS)
        uint256 deviationBps = SafeOracleMath.calculateDeviationBps(expectedAmountOut, minAmountOut);

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
