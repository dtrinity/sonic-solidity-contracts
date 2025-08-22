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
     * @notice Performs a swap operation using Odos router with swap data
     * @param router Odos router contract
     * @param inputToken Input token address
     * @param outputToken Output token address
     * @param maxIn Maximum input amount
     * @param exactOut Exact output amount expected
     * @param swapData Encoded swap path data
     * @return actualAmountSpent The actual amount of input tokens spent
     */
    function executeSwapOperation(
        IOdosRouterV2 router,
        address inputToken,
        address outputToken,
        uint256 maxIn,
        uint256 exactOut,
        bytes memory swapData
    ) internal returns (uint256 actualAmountSpent) {
        uint256 outputBalanceBefore = IERC20(outputToken).balanceOf(address(this));

        // Use forceApprove for external DEX router integration
        IERC20(inputToken).forceApprove(address(router), maxIn);

        (bool success, bytes memory result) = address(router).call(swapData);
        if (!success) {
            if (result.length > 0) {
                assembly {
                    let resultLength := mload(result)
                    revert(add(32, result), resultLength)
                }
            }
            revert SwapFailed();
        }

        assembly {
            actualAmountSpent := mload(add(result, 32))
        }

        uint256 outputBalanceAfter = IERC20(outputToken).balanceOf(address(this));
        uint256 actualAmountReceived = outputBalanceAfter - outputBalanceBefore;

        if (actualAmountReceived < exactOut) {
            revert InsufficientOutput(exactOut, actualAmountReceived);
        }

        IERC20(inputToken).approve(address(router), 0);

        return actualAmountSpent;
    }
}
