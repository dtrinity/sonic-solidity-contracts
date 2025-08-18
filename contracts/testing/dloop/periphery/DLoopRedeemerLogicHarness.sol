// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {DLoopCoreBase} from "contracts/vaults/dloop/core/DLoopCoreBase.sol";
import {DLoopRedeemerLogic} from "contracts/vaults/dloop/periphery/helper/DLoopRedeemerLogic.sol";

contract DLoopRedeemerLogicHarness {
    function calculateMinOutputCollateralPublic(
        uint256 shares,
        uint256 slippageBps,
        DLoopCoreBase dLoopCore
    ) external view returns (uint256) {
        return
            DLoopRedeemerLogic.calculateMinOutputCollateral(
                shares,
                slippageBps,
                dLoopCore
            );
    }

    function encodeFlashLoanParamsPublic(
        uint256 shares,
        bytes memory collateralToDebtTokenSwapData,
        DLoopCoreBase dLoopCore
    ) external pure returns (bytes memory) {
        return
            DLoopRedeemerLogic.encodeFlashLoanParams(
                shares,
                collateralToDebtTokenSwapData,
                dLoopCore
            );
    }

    function decodeFlashLoanParamsPublic(
        bytes memory data
    )
        external
        pure
        returns (
            uint256 shares,
            bytes memory collateralToDebtTokenSwapData,
            DLoopCoreBase dLoopCore
        )
    {
        return DLoopRedeemerLogic.decodeFlashLoanParams(data);
    }
}
