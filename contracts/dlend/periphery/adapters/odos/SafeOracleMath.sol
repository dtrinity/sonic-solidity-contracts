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

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title SafeOracleMath
 * @notice Safe arithmetic operations for oracle price calculations
 * @dev Uses OpenZeppelin's Math.mulDiv to prevent overflow in intermediate calculations
 * @dev Specifically designed for oracle validation where: (amount * price * 10^decimals) / (price * 10^decimals)
 */
library SafeOracleMath {
    /**
     * @notice Calculates expected output amount using oracle prices with overflow protection
     * @dev Formula: (amountIn * priceIn * 10^decimalsOut) / (priceOut * 10^decimalsIn)
     * @dev Uses mulDiv to prevent overflow in intermediate multiplication
     * @param amountIn The input amount
     * @param priceIn The input token price (8 decimals from oracle)
     * @param priceOut The output token price (8 decimals from oracle)
     * @param decimalsIn The input token decimals
     * @param decimalsOut The output token decimals
     * @return expectedAmountOut The expected output amount
     */
    function calculateExpectedOutput(
        uint256 amountIn,
        uint256 priceIn,
        uint256 priceOut,
        uint256 decimalsIn,
        uint256 decimalsOut
    ) internal pure returns (uint256 expectedAmountOut) {
        // Step 1: amountIn * priceIn (safe with mulDiv)
        uint256 amountInValue = Math.mulDiv(amountIn, priceIn, 1);

        // Step 2: amountInValue * 10^decimalsOut (safe with mulDiv)
        uint256 scaledValue = Math.mulDiv(amountInValue, 10 ** decimalsOut, 1);

        // Step 3: scaledValue / (priceOut * 10^decimalsIn)
        uint256 denominator = Math.mulDiv(priceOut, 10 ** decimalsIn, 1);

        // Step 4: Final division
        expectedAmountOut = scaledValue / denominator;

        return expectedAmountOut;
    }

    /**
     * @notice Calculates expected input amount using oracle prices with overflow protection
     * @dev Formula: (exactAmountOut * priceOut * 10^decimalsIn) / (priceIn * 10^decimalsOut)
     * @dev Uses mulDiv to prevent overflow in intermediate multiplication
     * @param exactAmountOut The exact output amount required
     * @param priceIn The input token price (8 decimals from oracle)
     * @param priceOut The output token price (8 decimals from oracle)
     * @param decimalsIn The input token decimals
     * @param decimalsOut The output token decimals
     * @return expectedAmountIn The expected input amount
     */
    function calculateExpectedInput(
        uint256 exactAmountOut,
        uint256 priceIn,
        uint256 priceOut,
        uint256 decimalsIn,
        uint256 decimalsOut
    ) internal pure returns (uint256 expectedAmountIn) {
        // Step 1: exactAmountOut * priceOut (safe with mulDiv)
        uint256 amountOutValue = Math.mulDiv(exactAmountOut, priceOut, 1);

        // Step 2: amountOutValue * 10^decimalsIn (safe with mulDiv)
        uint256 scaledValue = Math.mulDiv(amountOutValue, 10 ** decimalsIn, 1);

        // Step 3: scaledValue / (priceIn * 10^decimalsOut)
        uint256 denominator = Math.mulDiv(priceIn, 10 ** decimalsOut, 1);

        // Step 4: Final division
        expectedAmountIn = scaledValue / denominator;

        return expectedAmountIn;
    }

    /**
     * @notice Calculates deviation in basis points with overflow protection
     * @dev Formula: |expected - actual| * 10000 / expected
     * @dev Uses mulDiv to prevent overflow in (difference * 10000)
     * @param expected The expected amount
     * @param actual The actual amount
     * @return deviationBps The deviation in basis points
     */
    function calculateDeviationBps(uint256 expected, uint256 actual) internal pure returns (uint256 deviationBps) {
        uint256 difference;
        if (expected > actual) {
            difference = expected - actual;
        } else {
            difference = actual - expected;
        }

        // Use mulDiv to safely calculate (difference * 10000) / expected
        deviationBps = Math.mulDiv(difference, 10000, expected);

        return deviationBps;
    }
}
