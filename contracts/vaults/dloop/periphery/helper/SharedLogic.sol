// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DLoopCoreBase } from "../../core/DLoopCoreBase.sol";
import { DLoopCoreLogic } from "../../core/DLoopCoreLogic.sol";

/**
 * @title SharedLogic
 * @dev Shared utility functions for dLoop periphery contracts
 */
library SharedLogic {
    /**
     * @dev Gets the leveraged assets for a given assets and dLoopCore
     * Uses current leverage if > 0, otherwise falls back to target leverage
     * @param assets Amount of assets
     * @param dLoopCore Address of the DLoopCore contract
     * @return leveragedAssets Amount of leveraged assets
     */
    function getLeveragedAssets(uint256 assets, DLoopCoreBase dLoopCore) internal view returns (uint256) {
        return
            dLoopCore.getCurrentLeverageBps() > 0
                ? DLoopCoreLogic.getLeveragedAssetsWithLeverage(assets, dLoopCore.getCurrentLeverageBps())
                : DLoopCoreLogic.getLeveragedAssetsWithLeverage(assets, dLoopCore.targetLeverageBps());
    }

    /**
     * @dev Gets the unleveraged assets for a given leveraged assets and dLoopCore
     * Uses current leverage if > 0, otherwise falls back to target leverage
     * @param leveragedAssets Amount of leveraged assets
     * @param dLoopCore Address of the DLoopCore contract
     * @return unleveragedAssets Amount of unleveraged assets
     */
    function getUnleveragedAssets(uint256 leveragedAssets, DLoopCoreBase dLoopCore) internal view returns (uint256) {
        return
            dLoopCore.getCurrentLeverageBps() > 0
                ? DLoopCoreLogic.getUnleveragedAssetsWithLeverage(leveragedAssets, dLoopCore.getCurrentLeverageBps())
                : DLoopCoreLogic.getUnleveragedAssetsWithLeverage(leveragedAssets, dLoopCore.targetLeverageBps());
    }
}
