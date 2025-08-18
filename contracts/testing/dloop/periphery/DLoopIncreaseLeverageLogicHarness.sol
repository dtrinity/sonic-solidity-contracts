// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {DLoopCoreBase} from "contracts/vaults/dloop/core/DLoopCoreBase.sol";
import {DLoopIncreaseLeverageLogic} from "contracts/vaults/dloop/periphery/helper/DLoopIncreaseLeverageLogic.sol";

contract DLoopIncreaseLeverageLogicHarness {
    function encodeFlashLoanParamsPublic(
        address user,
        uint256 additionalCollateralFromUser,
        uint256 requiredCollateralAmount,
        bytes memory debtTokenToCollateralSwapData,
        DLoopCoreBase dLoopCore
    ) external pure returns (bytes memory) {
        return
            DLoopIncreaseLeverageLogic.encodeFlashLoanParams(
                user,
                additionalCollateralFromUser,
                requiredCollateralAmount,
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
            address user,
            uint256 additionalCollateralFromUser,
            uint256 requiredCollateralAmount,
            bytes memory debtTokenToCollateralSwapData,
            DLoopCoreBase dLoopCore
        )
    {
        return DLoopIncreaseLeverageLogic.decodeFlashLoanParams(data);
    }
}
