// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {DLoopCoreBase} from "../../core/DLoopCoreBase.sol";

/**
 * @title DLoopDecreaseLeverageLogic
 * @dev Encoding/decoding logic extracted from `DLoopDecreaseLeverageBase`
 */
library DLoopDecreaseLeverageLogic {
    /**
     * @dev Encodes flash loan parameters to data
     */
    function encodeFlashLoanParams(
        address user,
        uint256 additionalDebtFromUser,
        uint256 requiredDebtAmount,
        bytes memory collateralToDebtTokenSwapData,
        DLoopCoreBase dLoopCore
    ) internal pure returns (bytes memory data) {
        data = abi.encode(
            user,
            additionalDebtFromUser,
            requiredDebtAmount,
            collateralToDebtTokenSwapData,
            dLoopCore
        );
    }

    /**
     * @dev Decodes data to flash loan parameters (tuple form)
     */
    function decodeFlashLoanParams(
        bytes memory data
    )
        internal
        pure
        returns (
            address user,
            uint256 additionalDebtFromUser,
            uint256 requiredDebtAmount,
            bytes memory collateralToDebtTokenSwapData,
            DLoopCoreBase dLoopCore
        )
    {
        (
            user,
            additionalDebtFromUser,
            requiredDebtAmount,
            collateralToDebtTokenSwapData,
            dLoopCore
        ) = abi.decode(data, (address, uint256, uint256, bytes, DLoopCoreBase));
    }
}
