// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title DLoopCoreViewStub
 * @dev Minimal view-only stub to satisfy periphery logic libraries in tests.
 *      Emulates a vault with target leverage = 3x and 1:1 shares/assets for simplicity.
 */
contract DLoopCoreViewStub {
    function convertToShares(uint256 assets) external pure returns (uint256) {
        return assets;
    }

    function previewRedeem(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function getCurrentLeverageBps() external pure returns (uint256) {
        return 0; // force SharedLogic to use target leverage
    }

    function getTargetLeveragedAssets(
        uint256 assets
    ) external pure returns (uint256) {
        return assets * 3;
    }

    function getCurrentLeveragedAssets(
        uint256 assets
    ) external pure returns (uint256) {
        return assets * 3;
    }

    function getUnleveragedAssetsWithTargetLeverage(
        uint256 leveragedAssets
    ) external pure returns (uint256) {
        return leveragedAssets / 3;
    }

    function getUnleveragedAssetsWithCurrentLeverage(
        uint256 leveragedAssets
    ) external pure returns (uint256) {
        return leveragedAssets / 3;
    }
}
