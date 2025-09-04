// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PendleSwapUtils
 * @notice Library for handling Pendle PT token swaps using SDK-generated transaction data
 * @dev This library executes pre-computed transaction data from Pendle's hosted SDK
 */
library PendleSwapUtils {
    using SafeERC20 for ERC20;

    /// @notice Custom error for failed Pendle swap with no revert reason
    error PendleSwapFailed();
    /// @notice Custom error when PT token approval fails
    error PTApprovalFailed();

    /**
     * @notice Executes a Pendle PT swap operation using SDK-generated transaction data
     * @dev This function executes the swap and returns the actual amount spent from the swap result.
     *      Underlying tokens go directly to the receiver specified in the Pendle SDK call data.
     * @param ptToken The PT token being swapped
     * @param ptAmount Amount of PT tokens to swap
     * @param router Pendle router contract address from Pendle SDK
     * @param swapData Transaction data from Pendle SDK
     * @return amountSpent Actual amount spent from the Pendle swap result
     */
    function executePendleSwap(
        address ptToken,
        uint256 ptAmount,
        address router,
        bytes memory swapData
    ) internal returns (uint256 amountSpent) {
        // Approve PT tokens to target contract
        ERC20(ptToken).forceApprove(router, ptAmount);

        // Check if approval was successful
        uint256 currentAllowance = ERC20(ptToken).allowance(address(this), router);
        if (currentAllowance < ptAmount) {
            revert PTApprovalFailed();
        }

        // Execute Pendle SDK transaction
        (bool success, bytes memory result) = router.call(swapData);
        if (!success) {
            // Decode the revert reason if present
            if (result.length > 0) {
                assembly {
                    let resultLength := mload(result)
                    revert(add(32, result), resultLength)
                }
            }
            revert PendleSwapFailed();
        }

        assembly {
            amountSpent := mload(add(result, 32))
        }

        return amountSpent;
    }
}
