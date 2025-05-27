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

import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

interface PriceGetter {
  function getAssetPriceFromOracle(address asset) external view returns (uint256);
}

library SwapHelper {
  /**
   * @notice Estimates the input amount from an exact output amount
   * @param inputToken The input token
   * @param outputToken The output token
   * @param outputAmount The output amount
   * @param slippageTolerance The slippage tolerance
   * @param priceGetter The price getter
   * @return maxDebtInputAmount The max input amount
   */
  function estimateInputAmountFromExactOutputAmount(
    ERC20 inputToken,
    ERC20 outputToken,
    uint256 outputAmount,
    uint256 slippageTolerance,
    PriceGetter priceGetter
  ) internal view returns (uint256) {
    // Calculate the estimated input amount from the given output amount
    uint256 estimatedInputAmount = (outputAmount *
        (priceGetter.getAssetPriceFromOracle(address(outputToken)) *
            (10 ** inputToken.decimals()))) /
        (priceGetter.getAssetPriceFromOracle(address(inputToken)) *
            (10 ** outputToken.decimals()));
    // Calculate the max input amount with slippage tolerance
    uint256 maxInputAmount = (estimatedInputAmount *
        (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
            slippageTolerance)) /
        BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
    return maxInputAmount;
  }

  /**
   * @notice Get the amount with slippage tolerance
   * @param amount The amount
   * @param slippageTolerance The slippage tolerance
   * @return amountWithSlippageTolerance The amount with slippage tolerance
   */
  function getAmountWithSlippageTolerance(uint256 amount, uint256 slippageTolerance) internal pure returns (uint256) {
    return (amount * (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
            slippageTolerance)) /
        BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
  }
}
