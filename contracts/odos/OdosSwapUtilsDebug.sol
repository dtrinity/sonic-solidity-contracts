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
    function executeSwapOperationWithBreakPoint(
        IOdosRouterV2 router,
        address inputToken,
        address outputToken,
        uint256 maxIn,
        uint256 exactOut,
        bytes memory swapData,
        uint256 breakPoint
    ) internal returns (uint256 actualAmountSpent) {
        uint256 outputBalanceBefore = IERC20(outputToken).balanceOf(address(this));

        // Use forceApprove for external DEX router integration
        IERC20(inputToken).forceApprove(address(router), maxIn);

        (bool success, bytes memory result) = address(router).call(swapData);
        if (!success) {
            require(breakPoint != 70001, "70001");
            if (result.length > 0) {
                require(breakPoint != 70002, "70002");
                assembly {
                    let resultLength := mload(result)
                    revert(add(32, result), resultLength)
                }
            }
            require(breakPoint != 70003, "70003");
            revert SwapFailed();
        }

        assembly {
            actualAmountSpent := mload(add(result, 32))
        }

        require(breakPoint != 70004, "70004");

        // Declare variables closer to usage to reduce stack depth
        uint256 outputBalanceAfter;
        {
            outputBalanceAfter = IERC20(outputToken).balanceOf(address(this));

            uint256 actualAmountReceived = outputBalanceAfter - outputBalanceBefore;
            require(breakPoint != 70005, string.concat("70005: actualAmountReceived:", uint256ToString(actualAmountReceived), ", exactOut:", uint256ToString(exactOut)));
            if (actualAmountReceived < exactOut) {
                revert InsufficientOutput(exactOut, actualAmountReceived);
            }
        }

        require(breakPoint != 70006, "70006");

        IERC20(inputToken).approve(address(router), 0);

        return actualAmountSpent;
    }

    function uint256ToString(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) {
            return "0";
        }
        uint256 j = _i;
        uint256 length;
        while (j != 0) {
            length++;
            j /= 10;
        }

        bytes memory bstr = new bytes(length);
        uint256 k = length;
        j = _i;
        while (j != 0) {
            bstr[--k] = bytes1(uint8(48 + (j % 10)));
            j /= 10;
        }
        return string(bstr);
    }
}
