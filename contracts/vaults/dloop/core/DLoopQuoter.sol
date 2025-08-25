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

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { DLoopCoreBase } from "./DLoopCoreBase.sol";
import { DLoopCoreLogic } from "./DLoopCoreLogic.sol";

contract DLoopQuoter {
    /* Rebalance */

    /**
     * @notice Gets the rebalance amount to reach the target leverage in token units
     * @dev This method is used by rebalancing services to quote required collateral/debt amounts
     *      and determine the rebalancing direction (increase or decrease leverage)
     * @param dLoopCore The DLoopCoreBase contract
     * @return inputTokenAmount The amount of token to call increaseLeverage or decreaseLeverage (in token unit)
     *         - If direction is 1, the amount is in collateral token
     *         - If direction is -1, the amount is in debt token
     * @return estimatedOutputTokenAmount The estimated output token amount after the rebalance (in token unit)
     *         - If direction is 1, the amount is in debt token
     *         - If direction is -1, the amount is in collateral token
     * @return direction The direction of the rebalance (1 for increase, -1 for decrease, 0 means no rebalance)
     */
    function quoteRebalanceAmountToReachTargetLeverage(
        DLoopCoreBase dLoopCore
    ) public view returns (uint256 inputTokenAmount, uint256 estimatedOutputTokenAmount, int8 direction) {
        (uint256 totalCollateralBase, uint256 totalDebtBase) = dLoopCore.getTotalCollateralAndDebtOfUserInBase(
            address(dLoopCore)
        );
        ERC20 collateralToken = ERC20(dLoopCore.collateralToken());
        ERC20 debtToken = ERC20(dLoopCore.debtToken());

        return
            DLoopCoreLogic.quoteRebalanceAmountToReachTargetLeverage(
                totalCollateralBase,
                totalDebtBase,
                dLoopCore.getCurrentLeverageBps(),
                dLoopCore.targetLeverageBps(),
                dLoopCore.getCurrentSubsidyBps(),
                collateralToken.decimals(),
                dLoopCore.getAssetPriceFromOracle(address(collateralToken)),
                debtToken.decimals(),
                dLoopCore.getAssetPriceFromOracle(address(debtToken))
            );
    }
}
