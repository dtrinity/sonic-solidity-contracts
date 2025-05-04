// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import "./interface/IOdosRouterV2.sol";
import {SafeERC20, ERC20} from "../libraries/SafeERC20.sol";
/**
 * @title OdosSwapUtils
 * @notice Library for handling Odos swaps in liquidator contracts
 */
library OdosSwapUtils {
    using SafeERC20 for ERC20;

    /// @notice Custom error for failed swap with no revert reason
    error SwapFailed();
    /// @notice Custom error when actual output amount is less than expected
    error InsufficientOutput(uint256 expected, uint256 actual);

    /**
     * @notice Performs an swap operation using Odos router with swap data
     * @param router Odos router contract
     * @param inputToken Input token
     * @param maxIn Maximum input amount
     * @param exactOut Exact output amount
     * @param swapData Encoded swap path data
     */
    function excuteSwapOperation(
        IOdosRouterV2 router,
        address inputToken,
        uint256 maxIn,
        uint256 exactOut,
        bytes memory swapData
    ) internal returns (uint256) {
        ERC20(inputToken).safeIncreaseAllowance(address(router), maxIn);

        (bool success, bytes memory result) = address(router).call(swapData);
        if (!success) {
            // Decode the revert reason if present
            if (result.length > 0) {
                // First try to decode the standard revert reason
                assembly {
                    let resultLength := mload(result)
                    revert(add(32, result), resultLength)
                }
            }
            revert SwapFailed();
        }

        uint256 actualAmountOut;
        assembly {
            actualAmountOut := mload(add(result, 32))
        }

        if (actualAmountOut < exactOut) {
            revert InsufficientOutput(exactOut, actualAmountOut);
        }

        return actualAmountOut;
    }
}
