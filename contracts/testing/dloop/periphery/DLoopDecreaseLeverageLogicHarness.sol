// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {DLoopCoreBase} from "contracts/vaults/dloop/core/DLoopCoreBase.sol";
import {DLoopDecreaseLeverageLogic} from "contracts/vaults/dloop/periphery/helper/DLoopDecreaseLeverageLogic.sol";

contract DLoopDecreaseLeverageLogicHarness {
    function encodeFlashLoanParamsPublic(
        address user,
        uint256 additionalDebtFromUser,
        uint256 requiredDebtAmount,
        bytes memory collateralToDebtTokenSwapData,
        DLoopCoreBase dLoopCore
    ) external pure returns (bytes memory) {
        return
            DLoopDecreaseLeverageLogic.encodeFlashLoanParams(
                user,
                additionalDebtFromUser,
                requiredDebtAmount,
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
            address user,
            uint256 additionalDebtFromUser,
            uint256 requiredDebtAmount,
            bytes memory collateralToDebtTokenSwapData,
            DLoopCoreBase dLoopCore
        )
    {
        return DLoopDecreaseLeverageLogic.decodeFlashLoanParams(data);
    }
}
