// SPDX-License-Identifier: AGPL-3.0
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { PendleSwapUtils } from "contracts/pendle/PendleSwapUtils.sol";
import { OdosSwapUtils } from "contracts/odos/OdosSwapUtils.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { ISwapTypes } from "./interfaces/ISwapTypes.sol";
import { IBaseOdosAdapterV2 } from "./interfaces/IBaseOdosAdapterV2.sol";

/**
 * @title PendleSwapLogic
 * @notice Library for handling PT token operations and composed swaps
 * @dev Provides high-level logic for PT token detection and orchestrating composed PT+Odos swaps
 */
library PendleSwapLogic {
    using SafeERC20 for IERC20;

    /* Custom Errors */
    error InvalidPTToken(address token);
    // Use InvalidPTSwapData() from IBaseOdosAdapterV2
    error InsufficientPTSwapOutput(uint256 expected, uint256 actual);
    error UnderlyingBalanceInsufficient(uint256 required, uint256 available);
    error ComposedSwapFailed(string stage);

    /* Events */
    event PTTokenDetected(address indexed token, address indexed sy);
    event PTSwapExecuted(
        address indexed ptToken,
        address indexed underlyingAsset,
        uint256 ptAmount,
        uint256 underlyingAmount
    );
    event ComposedSwapCompleted(
        address indexed inputToken,
        address indexed outputToken,
        uint256 inputAmount,
        uint256 finalOutputAmount
    );

    /**
     * @notice Data structure for PT swap parameters
     * @param isComposed True if this is a composed PT+Odos swap
     * @param underlyingAsset The underlying asset from PT swap (for composed swaps)
     * @param pendleCalldata The Pendle swap calldata (for composed swaps)
     * @param odosCalldata The Odos swap calldata (can be empty for direct swaps)
     */
    struct PTSwapDataV2 {
        bool isComposed;
        address underlyingAsset;
        bytes pendleCalldata;
        bytes odosCalldata;
    }

    /**
     * @notice Check if a token is a PT token by calling the SY() method
     * @param token The token address to check
     * @return result True if the token appears to be a PT token
     * @return sy The SY address if it's a PT token, zero address otherwise
     */
    function isPTToken(address token) internal view returns (bool result, address sy) {
        // Try to call SY() method - PT tokens should have this
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("SY()"));

        // Check if call was successful and returned a valid address (not zero)
        if (success && data.length == 32) {
            sy = abi.decode(data, (address));
            result = sy != address(0);

            // Note: Events removed since this is now a view function
            // PT token detection events can be emitted at higher level if needed
        }
    }

    /**
     * @notice Execute a Pendle PT swap using router and swap data
     * @param ptToken The PT token being swapped
     * @param ptAmount Amount of PT tokens to swap
     * @param underlyingAsset The underlying asset that will be received
     * @param pendleRouter The Pendle router address
     * @param swapData Transaction data from Pendle SDK
     * @return actualUnderlyingOut Actual amount of underlying tokens received
     */
    function executePendleSwap(
        address ptToken,
        uint256 ptAmount,
        address underlyingAsset,
        address pendleRouter,
        bytes memory swapData
    ) internal returns (uint256 actualUnderlyingOut) {
        // Record underlying token balance before swap
        uint256 underlyingBalanceBefore = IERC20(underlyingAsset).balanceOf(address(this));

        // Execute Pendle swap via PendleSwapUtils library (PT → underlying)
        PendleSwapUtils.swapExactInput(ptToken, underlyingAsset, ptAmount, pendleRouter, swapData);

        // Calculate actual underlying tokens received with underflow protection
        uint256 underlyingBalanceAfter = IERC20(underlyingAsset).balanceOf(address(this));

        // Protect against underflow: ensure balance after >= balance before
        if (underlyingBalanceAfter < underlyingBalanceBefore) {
            revert UnderlyingBalanceInsufficient(0, underlyingBalanceBefore - underlyingBalanceAfter);
        }

        actualUnderlyingOut = underlyingBalanceAfter - underlyingBalanceBefore;

        emit PTSwapExecuted(ptToken, underlyingAsset, ptAmount, actualUnderlyingOut);

        return actualUnderlyingOut;
    }

    /**
     * @notice Execute composed swap: PT -> underlying -> target token
     * @param ptToken The PT token input
     * @param targetToken The final target token
     * @param ptAmount Amount of PT tokens to swap
     * @param minTargetOut Minimum amount of target tokens expected
     * @param pendleRouter The Pendle router address
     * @param odosRouter The Odos router address
     * @param swapData The PTSwapDataV2 containing swap parameters
     * @return actualTargetOut Actual amount of target tokens received
     */
    function executePTToTargetSwap(
        address ptToken,
        address targetToken,
        uint256 ptAmount,
        uint256 minTargetOut,
        address pendleRouter,
        IOdosRouterV2 odosRouter,
        PTSwapDataV2 memory swapData
    ) internal returns (uint256 actualTargetOut) {
        // Validate swap data
        if (!swapData.isComposed || swapData.underlyingAsset == address(0)) {
            revert IBaseOdosAdapterV2.InvalidPTSwapData();
        }

        // Stage 1: PT -> underlying via Pendle
        uint256 underlyingReceived = executePendleSwap(
            ptToken,
            ptAmount,
            swapData.underlyingAsset,
            pendleRouter,
            swapData.pendleCalldata
        );

        // Stage 2: underlying -> target via Odos (if needed)
        if (swapData.underlyingAsset == targetToken) {
            // Direct case: underlying is the target token
            actualTargetOut = underlyingReceived;

            // Validate slippage protection even in direct path
            if (actualTargetOut < minTargetOut) {
                revert InsufficientPTSwapOutput(minTargetOut, actualTargetOut);
            }
        } else {
            // Need Odos swap: underlying -> target
            if (swapData.odosCalldata.length == 0) {
                revert IBaseOdosAdapterV2.InvalidPTSwapData();
            }

            actualTargetOut = OdosSwapUtils.executeSwapOperation(
                odosRouter,
                swapData.underlyingAsset,
                targetToken,
                underlyingReceived,
                minTargetOut,
                swapData.odosCalldata
            );
        }

        emit ComposedSwapCompleted(ptToken, targetToken, ptAmount, actualTargetOut);
        return actualTargetOut;
    }

    /**
     * @notice Execute composed swap: source token -> underlying -> PT
     * @param sourceToken The source token input
     * @param ptToken The final PT token
     * @param sourceAmount Amount of source tokens to swap
     * @param minPTOut Minimum amount of PT tokens expected
     * @param pendleRouter The Pendle router address
     * @param odosRouter The Odos router address
     * @param swapData The PTSwapDataV2 containing swap parameters
     * @return actualPTOut Actual amount of PT tokens received
     */
    function executeSourceToPTSwap(
        address sourceToken,
        address ptToken,
        uint256 sourceAmount,
        uint256 minPTOut,
        address pendleRouter,
        IOdosRouterV2 odosRouter,
        PTSwapDataV2 memory swapData
    ) internal returns (uint256 actualPTOut) {
        // Validate swap data
        if (!swapData.isComposed || swapData.underlyingAsset == address(0)) {
            revert IBaseOdosAdapterV2.InvalidPTSwapData();
        }

        uint256 underlyingAmount;

        // Stage 1: source -> underlying via Odos (if needed)
        if (sourceToken == swapData.underlyingAsset) {
            // Direct case: source is the underlying token
            underlyingAmount = sourceAmount;
        } else {
            // Need Odos swap: source -> underlying
            if (swapData.odosCalldata.length == 0) {
                revert IBaseOdosAdapterV2.InvalidPTSwapData();
            }

            // Record balance before Odos swap
            uint256 underlyingBalanceBeforeOdos = IERC20(swapData.underlyingAsset).balanceOf(address(this));

            // Execute Odos swap (return value is informational only)
            OdosSwapUtils.executeSwapOperation(
                odosRouter,
                sourceToken,
                swapData.underlyingAsset,
                sourceAmount,
                0, // minOut is handled in final PT check
                swapData.odosCalldata
            );

            // Verify we actually received underlying tokens with underflow protection
            uint256 underlyingBalanceAfterOdos = IERC20(swapData.underlyingAsset).balanceOf(address(this));

            if (underlyingBalanceAfterOdos < underlyingBalanceBeforeOdos) {
                revert IBaseOdosAdapterV2.OdosSwapFailed("Odos swap resulted in balance decrease");
            }

            // Use actual measured balance change (safer than trusting return value)
            underlyingAmount = underlyingBalanceAfterOdos - underlyingBalanceBeforeOdos;

            if (underlyingAmount == 0) {
                revert IBaseOdosAdapterV2.OdosSwapFailed("Odos swap returned zero underlying tokens");
            }
        }

        // Stage 2: underlying → PT via PendleSwapUtils
        actualPTOut = PendleSwapUtils.swapExactInput(
            swapData.underlyingAsset,
            ptToken,
            underlyingAmount,
            pendleRouter,
            swapData.pendleCalldata
        );

        if (actualPTOut < minPTOut) {
            revert InsufficientPTSwapOutput(minPTOut, actualPTOut);
        }

        emit PTSwapExecuted(swapData.underlyingAsset, ptToken, underlyingAmount, actualPTOut);
        emit ComposedSwapCompleted(sourceToken, ptToken, sourceAmount, actualPTOut);

        return actualPTOut;
    }

    /**
     * @notice Execute hybrid PT to PT swap using Odos + Pendle
     * @dev Uses Odos for PT input → underlying asset, then Pendle for underlying asset → PT output
     * @param inputPTToken The input PT token
     * @param outputPTToken The output PT token
     * @param inputAmount Amount of input PT tokens to swap
     * @param minOutputAmount Minimum amount of output PT tokens expected
     * @param pendleRouter The Pendle router address
     * @param odosRouter The Odos router address
     * @param swapData The PTSwapDataV2 containing both Odos and Pendle swap parameters
     * @return actualOutputAmount Actual amount of output PT tokens received
     */
    function executePTToPTSwap(
        address inputPTToken,
        address outputPTToken,
        uint256 inputAmount,
        uint256 minOutputAmount,
        address pendleRouter,
        IOdosRouterV2 odosRouter,
        PTSwapDataV2 memory swapData
    ) internal returns (uint256 actualOutputAmount) {
        // Validate that this is a PT to PT swap
        (bool inputIsPT, ) = isPTToken(inputPTToken);
        (bool outputIsPT, ) = isPTToken(outputPTToken);

        if (!inputIsPT || !outputIsPT) {
            revert InvalidPTToken(inputPTToken);
        }

        // For PT to PT hybrid swap, we need both Odos and Pendle calldata + underlying asset
        if (
            !swapData.isComposed ||
            swapData.underlyingAsset == address(0) ||
            swapData.odosCalldata.length == 0 ||
            swapData.pendleCalldata.length == 0
        ) {
            revert IBaseOdosAdapterV2.InvalidPTSwapData();
        }

        // Stage 1: PT input → underlying asset via Odos
        uint256 actualUnderlyingReceived;
        {
            uint256 underlyingBalanceBefore = IERC20(swapData.underlyingAsset).balanceOf(address(this));

            // Execute Odos swap (return value is informational only)
            OdosSwapUtils.executeSwapOperation(
                odosRouter,
                inputPTToken,
                swapData.underlyingAsset,
                inputAmount,
                0, // minOut handled in final PT check
                swapData.odosCalldata
            );

            // Verify we received underlying tokens with underflow protection
            uint256 underlyingBalanceAfter = IERC20(swapData.underlyingAsset).balanceOf(address(this));

            if (underlyingBalanceAfter < underlyingBalanceBefore) {
                revert IBaseOdosAdapterV2.OdosSwapFailed("Odos PT swap resulted in balance decrease");
            }

            // Use actual measured balance change (safer than trusting return value)
            actualUnderlyingReceived = underlyingBalanceAfter - underlyingBalanceBefore;
        }

        if (actualUnderlyingReceived == 0) {
            revert IBaseOdosAdapterV2.OdosSwapFailed("Odos PT swap returned zero underlying tokens");
        }

        emit PTSwapExecuted(inputPTToken, swapData.underlyingAsset, inputAmount, actualUnderlyingReceived);

        // Stage 2: underlying asset → PT output via PendleSwapUtils
        actualOutputAmount = PendleSwapUtils.swapExactInput(
            swapData.underlyingAsset,
            outputPTToken,
            actualUnderlyingReceived,
            pendleRouter,
            swapData.pendleCalldata
        );

        if (actualOutputAmount < minOutputAmount) {
            revert InsufficientPTSwapOutput(minOutputAmount, actualOutputAmount);
        }

        emit PTSwapExecuted(swapData.underlyingAsset, outputPTToken, actualUnderlyingReceived, actualOutputAmount);
        emit ComposedSwapCompleted(inputPTToken, outputPTToken, inputAmount, actualOutputAmount);

        return actualOutputAmount;
    }

    /**
     * @notice Validate PTSwapDataV2 structure
     * @param swapData The PTSwapDataV2 struct to validate
     * @return isValid True if the swap data is valid
     */
    function validatePTSwapData(PTSwapDataV2 memory swapData) internal pure returns (bool isValid) {
        if (!swapData.isComposed) {
            // For regular swaps, we just need odos calldata
            return swapData.odosCalldata.length > 0;
        }

        // For composed swaps, we need at least valid pendle calldata
        if (swapData.pendleCalldata.length == 0) {
            return false;
        }

        // For PT to PT hybrid swaps, we need both Odos and Pendle calldata + underlying asset
        // For other composed swaps, we need valid underlying asset
        // Odos calldata can be empty (for direct underlying → target cases)
        return true; // If we have Pendle calldata, it's valid (underlying asset check done in specific functions)
    }

    /**
     * @notice Determine swap strategy based on input/output tokens
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @return swapType The appropriate swap strategy
     */
    function determineSwapType(
        address inputToken,
        address outputToken
    ) internal view returns (ISwapTypes.SwapType swapType) {
        (bool inputIsPT, ) = isPTToken(inputToken);
        (bool outputIsPT, ) = isPTToken(outputToken);

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
}
