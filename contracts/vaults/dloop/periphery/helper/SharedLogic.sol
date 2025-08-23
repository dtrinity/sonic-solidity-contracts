// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DLoopCoreBase } from "../../core/DLoopCoreBase.sol";

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
                ? dLoopCore.getCurrentLeveragedAssets(assets)
                : dLoopCore.getTargetLeveragedAssets(assets);
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
                ? dLoopCore.getUnleveragedAssetsWithCurrentLeverage(leveragedAssets)
                : dLoopCore.getUnleveragedAssetsWithTargetLeverage(leveragedAssets);
    }
}
