// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import "./interface/IOdosRouterV2.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title OdosSwapUtils
 * @notice Library for handling Odos swaps in liquidator contracts
 */
library OdosSwapUtils {
    using SafeERC20 for IERC20;

    /// @notice Custom error for failed swap with no revert reason
    error SwapFailed();
    /// @notice Custom error when actual output amount is less than expected
    error InsufficientOutput(uint256 expected, uint256 actual);

    /**
     * @notice Performs an swap operation using Odos router with swap data
     * @param router Odos router contract
     * @param inputToken Input token
     * @param outputToken Output token
     * @param maxIn Maximum input amount
     * @param exactOut Exact output amount
     * @param swapData Encoded swap path data
     */
    function executeSwapOperation(
        IOdosRouterV2 router,
        address inputToken,
        address outputToken,
        uint256 maxIn,
        uint256 exactOut,
        bytes memory swapData
    ) internal returns (uint256) {
        // Track output token balance before swap
        uint256 balanceBefore = IERC20(outputToken).balanceOf(address(this));

        // Use forceApprove for external DEX router integration
        IERC20(inputToken).forceApprove(address(router), maxIn);

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

        // Calculate actual amount out by checking balance difference
        uint256 balanceAfter = IERC20(outputToken).balanceOf(address(this));
        uint256 actualAmountOut = balanceAfter - balanceBefore;

        if (actualAmountOut < exactOut) {
            revert InsufficientOutput(exactOut, actualAmountOut);
        }

        return actualAmountOut;
    }
}
