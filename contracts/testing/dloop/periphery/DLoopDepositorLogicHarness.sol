// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {DLoopCoreBase} from "contracts/vaults/dloop/core/DLoopCoreBase.sol";
import {DLoopDepositorLogic} from "contracts/vaults/dloop/periphery/helper/DLoopDepositorLogic.sol";

contract DLoopDepositorLogicHarness {
    function calculateMinOutputSharesPublic(
        uint256 depositAmount,
        uint256 slippageBps,
        DLoopCoreBase dLoopCore
    ) external view returns (uint256) {
        return
            DLoopDepositorLogic.calculateMinOutputShares(
                depositAmount,
                slippageBps,
                dLoopCore
            );
    }

    function calculateEstimatedOverallSlippageBpsPublic(
        uint256 currentEstimatedShares,
        uint256 minOutputShares
    ) external pure returns (uint256) {
        return
            DLoopDepositorLogic.calculateEstimatedOverallSlippageBps(
                currentEstimatedShares,
                minOutputShares
            );
    }

    function calculateRequiredAdditionalCollateralPublic(
        uint256 leveragedCollateralAmount,
        uint256 depositCollateralAmount
    ) external pure returns (uint256) {
        return
            DLoopDepositorLogic.calculateRequiredAdditionalCollateral(
                leveragedCollateralAmount,
                depositCollateralAmount
            );
    }

    function encodeFlashLoanParamsPublic(
        address receiver,
        uint256 depositCollateralAmount,
        uint256 leveragedCollateralAmount,
        bytes memory debtTokenToCollateralSwapData,
        DLoopCoreBase dLoopCore
    ) external pure returns (bytes memory) {
        return
            DLoopDepositorLogic.encodeFlashLoanParams(
                receiver,
                depositCollateralAmount,
                leveragedCollateralAmount,
                debtTokenToCollateralSwapData,
                dLoopCore
            );
    }

    function decodeFlashLoanParamsPublic(
        bytes memory data
    )
        external
        pure
        returns (
            address receiver,
            uint256 depositCollateralAmount,
            uint256 leveragedCollateralAmount,
            bytes memory debtTokenToCollateralSwapData,
            DLoopCoreBase dLoopCore
        )
    {
        return DLoopDepositorLogic.decodeFlashLoanParams(data);
    }
}
