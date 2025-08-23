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

abstract contract ThresholdingUtils {
    /* Types */
    struct ThresholdConfig {
        /// @notice The minimum price after which thresholding is applied. Not a price cap, but a trigger point.
        /// @dev If lowerThresholdInBase == fixedPriceInBase: Acts as an upper threshold
        /// @dev If lowerThresholdInBase < fixedPriceInBase: Acts as "price rounding up" (e.g. if USDC > 0.997 then round to 1)
        /// @dev If lowerThresholdInBase > fixedPriceInBase: Acts as "price rounding down" (e.g. if USDC > 1.003 then round to 1)
        uint256 lowerThresholdInBase;
        uint256 fixedPriceInBase;
    }

    /**
     * @notice Apply threshold to a price value
     * @param priceInBase The price to check against threshold
     * @param thresholdConfig The threshold configuration
     * @return The original price or fixed price based on threshold
     */
    function _applyThreshold(
        uint256 priceInBase,
        ThresholdConfig memory thresholdConfig
    ) internal pure returns (uint256) {
        if (priceInBase > thresholdConfig.lowerThresholdInBase) {
            return thresholdConfig.fixedPriceInBase;
        }
        return priceInBase;
    }
}
