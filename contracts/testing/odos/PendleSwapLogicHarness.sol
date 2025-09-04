// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { PendleSwapLogic } from "../../dlend/periphery/adapters/odos/PendleSwapLogic.sol";
import { IOdosRouterV2 } from "../../odos/interface/IOdosRouterV2.sol";
import { ISwapTypes } from "../../dlend/periphery/adapters/odos/interfaces/ISwapTypes.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title PendleSwapLogicHarness
 * @notice Test harness to expose PendleSwapLogic library functions for testing
 */
contract PendleSwapLogicHarness {
    using PendleSwapLogic for *;

    /// @notice Expose isPTToken function
    /// @dev Returns the results immediately without emitting events for easier testing
    function isPTToken(address token) external view returns (bool result, address sy) {
        // Try to call SY() method - PT tokens should have this
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("SY()"));

        // Check if call was successful and returned a valid address (not zero)
        if (success && data.length == 32) {
            sy = abi.decode(data, (address));
            result = sy != address(0);
        }
    }

    /// @notice Expose determineSwapType function
    function determineSwapType(address inputToken, address outputToken) external view returns (ISwapTypes.SwapType) {
        (bool inputIsPT, ) = this.isPTToken(inputToken);
        (bool outputIsPT, ) = this.isPTToken(outputToken);

        if (!inputIsPT && !outputIsPT) {
            return ISwapTypes.SwapType.REGULAR_SWAP; // Regular Odos swap
        } else if (inputIsPT && !outputIsPT) {
            return ISwapTypes.SwapType.PT_TO_REGULAR; // PT → underlying → regular
        } else if (!inputIsPT && outputIsPT) {
            return ISwapTypes.SwapType.REGULAR_TO_PT; // Regular → underlying → PT
        } else {
            return ISwapTypes.SwapType.PT_TO_PT; // PT → PT (direct Pendle swap)
        }
    }

    /// @notice Expose validatePTSwapData function
    function validatePTSwapData(PendleSwapLogic.PTSwapDataV2 memory swapData) external pure returns (bool) {
        return PendleSwapLogic.validatePTSwapData(swapData);
    }

    /// @notice Expose executePendleSwap function
    function executePendleSwap(
        address ptToken,
        uint256 ptAmount,
        address underlyingAsset,
        address pendleRouter,
        bytes memory swapData
    ) external returns (uint256) {
        return PendleSwapLogic.executePendleSwap(ptToken, ptAmount, underlyingAsset, pendleRouter, swapData);
    }

    /// @notice Expose executePTToTargetSwap function
    function executePTToTargetSwap(
        address ptToken,
        address targetToken,
        uint256 ptAmount,
        uint256 minTargetOut,
        address pendleRouter,
        IOdosRouterV2 odosRouter,
        PendleSwapLogic.PTSwapDataV2 memory swapData
    ) external returns (uint256) {
        return
            PendleSwapLogic.executePTToTargetSwap(
                ptToken,
                targetToken,
                ptAmount,
                minTargetOut,
                pendleRouter,
                odosRouter,
                swapData
            );
    }

    /// @notice Expose executeSourceToPTSwap function
    function executeSourceToPTSwap(
        address sourceToken,
        address ptToken,
        uint256 sourceAmount,
        uint256 minPTOut,
        address pendleRouter,
        IOdosRouterV2 odosRouter,
        PendleSwapLogic.PTSwapDataV2 memory swapData
    ) external returns (uint256) {
        return
            PendleSwapLogic.executeSourceToPTSwap(
                sourceToken,
                ptToken,
                sourceAmount,
                minPTOut,
                pendleRouter,
                odosRouter,
                swapData
            );
    }

    /// @notice Expose executePTToPTSwap function
    function executePTToPTSwap(
        address inputPTToken,
        address outputPTToken,
        uint256 inputAmount,
        uint256 minOutputAmount,
        address pendleRouter,
        IOdosRouterV2 odosRouter,
        PendleSwapLogic.PTSwapDataV2 memory swapData
    ) external returns (uint256) {
        return
            PendleSwapLogic.executePTToPTSwap(
                inputPTToken,
                outputPTToken,
                inputAmount,
                minOutputAmount,
                pendleRouter,
                odosRouter,
                swapData
            );
    }

    /// @notice Helper function to receive tokens (for balance tracking in tests)
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
