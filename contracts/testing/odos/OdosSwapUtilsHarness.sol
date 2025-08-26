// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { OdosSwapUtils } from "contracts/odos/OdosSwapUtils.sol";

/// @title OdosSwapUtilsHarness
/// @dev Wraps the internal library call in a public function usable from tests.
contract OdosSwapUtilsHarness {
    function callExecuteSwap(
        IOdosRouterV2 router,
        address inputToken,
        address outputToken,
        uint256 maxIn,
        uint256 exactOut,
        bytes calldata swapData
    ) external returns (uint256 amountSpent) {
        amountSpent = OdosSwapUtils.executeSwapOperation(router, inputToken, outputToken, maxIn, exactOut, swapData);
    }
}
