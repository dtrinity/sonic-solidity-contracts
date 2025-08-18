// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {DLoopCoreBase} from "../../core/DLoopCoreBase.sol";

/**
 * @title DLoopIncreaseLeverageLogic
 * @dev Pure/view and encoding logic extracted from `DLoopIncreaseLeverageBase`
 */
library DLoopIncreaseLeverageLogic {
    /**
     * @dev Encodes flash loan parameters to data
     */
    function encodeFlashLoanParams(
        address user,
        uint256 additionalCollateralFromUser,
        uint256 requiredCollateralAmount,
        bytes memory debtTokenToCollateralSwapData,
        DLoopCoreBase dLoopCore
    ) internal pure returns (bytes memory data) {
        data = abi.encode(
            user,
            additionalCollateralFromUser,
            requiredCollateralAmount,
            debtTokenToCollateralSwapData,
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
            uint256 additionalCollateralFromUser,
            uint256 requiredCollateralAmount,
            bytes memory debtTokenToCollateralSwapData,
            DLoopCoreBase dLoopCore
        )
    {
        (
            user,
            additionalCollateralFromUser,
            requiredCollateralAmount,
            debtTokenToCollateralSwapData,
            dLoopCore
        ) = abi.decode(data, (address, uint256, uint256, bytes, DLoopCoreBase));
    }
}
