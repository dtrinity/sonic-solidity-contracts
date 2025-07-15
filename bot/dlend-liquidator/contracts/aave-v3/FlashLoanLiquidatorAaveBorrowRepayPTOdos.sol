// SPDX-License-Identifier: GNU AGPLv3
pragma solidity 0.8.20;

import "../odos/interface/IOdosRouterV2.sol";
import "../odos/OdosSwapUtils.sol";
import "../pendle/PendleSwapUtils.sol";
import "./FlashLoanLiquidatorAaveBorrowRepayBase.sol";

/**
 * @title FlashLoanLiquidatorAaveBorrowRepayPTOdos
 * @notice Flash loan liquidator contract that handles PT token liquidations with Pendle + Odos swaps
 * @dev This contract performs a two-stage swap using Aave flash loans:
 *      1. PT token → underlying asset (via Pendle)
 *      2. underlying asset → target token (via Odos)
 */
contract FlashLoanLiquidatorAaveBorrowRepayPTOdos is
    FlashLoanLiquidatorAaveBorrowRepayBase
{
    using SafeERC20 for ERC20;

    /// @notice Data structure for encoding PT swap parameters
    struct PTSwapData {
        address underlyingAsset;     // Underlying asset from PT swap
        address pendleRouter;        // Pendle router address
        bytes pendleCalldata;        // Transaction data from Pendle SDK
        address odosRouter;          // Odos router address
        bytes odosCalldata;          // Transaction data from Odos API (can be empty if no second swap needed)
    }

    /// @notice Custom errors
    error InsufficientOutputAfterSwap(uint256 expected, uint256 actual);
    error InvalidPTSwapData();
    error OdosSwapFailed(string reason);

    /// @notice Events
    event PTSwapExecuted(
        address indexed ptToken,
        address indexed underlyingToken,
        uint256 ptAmount,
        uint256 underlyingReceived
    );
    
    event TwoStageSwapExecuted(
        address indexed ptToken,
        address indexed underlyingToken,
        address indexed targetToken,
        uint256 ptAmount,
        uint256 underlyingReceived,
        uint256 targetReceived
    );

    /// @notice Immutable contract references
    IOdosRouterV2 public immutable odosRouter;
    
    constructor(
        ILendingPool _flashLoanLender,
        ILendingPoolAddressesProvider _addressesProvider,
        ILendingPool _liquidateLender,
        uint256 _slippageTolerance,
        IOdosRouterV2 _odosRouter
    )
        FlashLoanLiquidatorAaveBorrowRepayBase(
            _flashLoanLender,
            _addressesProvider,
            _liquidateLender,
            _slippageTolerance
        )
    {
        odosRouter = _odosRouter;
    }

    /**
     * @notice Executes a two-stage swap: PT token → underlying → target token
     * @param _inputToken The PT token address
     * @param _outputToken The final target token address
     * @param _swapData Encoded PTSwapData containing both Pendle and Odos swap parameters
     * @param _amount The exact amount of output tokens required
     * @param _maxIn The maximum amount of PT tokens to spend
     * @return amountIn The actual amount of PT tokens used
     */
    function _swapExactOutput(
        address _inputToken,
        address _outputToken,
        bytes memory _swapData,
        uint256 _amount,
        uint256 _maxIn
    ) internal override returns (uint256 amountIn) {
        // Decode PT swap data
        PTSwapData memory ptSwapData = abi.decode(_swapData, (PTSwapData));
        
        // Validate swap data
        if (ptSwapData.underlyingAsset == address(0)) {
            revert InvalidPTSwapData();
        }

        // Stage 1: Execute Pendle swap (PT → underlying)
        uint256 underlyingReceived = _executePendleSwap(
            _inputToken,
            _maxIn,
            ptSwapData.pendleRouter,
            ptSwapData.pendleCalldata
        );

        emit PTSwapExecuted(
            _inputToken,
            ptSwapData.underlyingAsset,
            _maxIn,
            underlyingReceived
        );

        // Stage 2: Execute Odos swap (underlying → target) or handle direct case
        uint256 targetReceived;
        if (ptSwapData.underlyingAsset == _outputToken) {
            // Direct case: underlying asset is the target token
            targetReceived = underlyingReceived;
        } else {
            // Need second swap via Odos
            if (ptSwapData.odosRouter == address(0) || ptSwapData.odosCalldata.length == 0) {
                revert InvalidPTSwapData();
            }
            
            targetReceived = _executeOdosSwap(
                ptSwapData.underlyingAsset,
                _outputToken,
                underlyingReceived,
                _amount,
                ptSwapData.odosRouter,
                ptSwapData.odosCalldata
            );
        }

        emit TwoStageSwapExecuted(
            _inputToken,
            ptSwapData.underlyingAsset,
            _outputToken,
            _maxIn,
            underlyingReceived,
            targetReceived
        );

        // Verify we got at least the required amount
        if (targetReceived < _amount) {
            revert InsufficientOutputAfterSwap(_amount, targetReceived);
        }

        // Handle any leftover tokens
        uint256 leftover = targetReceived - _amount;
        if (leftover > 0) {
            ERC20(_outputToken).safeTransfer(msg.sender, leftover);
        }

        // Return the amount of PT tokens used (assumed to be _maxIn for simplicity)
        // In practice, this could be calculated more precisely based on actual execution
        return _maxIn;
    }

    /**
     * @notice Executes a Pendle PT swap using SDK-generated transaction data
     * @param ptToken The PT token being swapped
     * @param ptAmount Amount of PT tokens to swap
     * @param target Target contract address from Pendle SDK
     * @param swapData Transaction data from Pendle SDK
     * @return actualUnderlyingOut Actual amount of underlying tokens received
     */
    function _executePendleSwap(
        address ptToken,
        uint256 ptAmount,
        address target,
        bytes memory swapData
    ) internal returns (uint256 actualUnderlyingOut) {
        // Call PendleSwapUtils library function directly
        // Note: Errors from the library will bubble up automatically
        return PendleSwapUtils.executePendleSwap(
            ptToken,
            ptAmount,
            target,
            swapData
        );
    }

    /**
     * @notice Executes an Odos swap using pre-calculated swap data
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param inputAmount The amount of input tokens to swap
     * @param minOutputAmount The minimum amount of output tokens required
     * @param target Target contract address from Odos API
     * @param swapData Transaction data from Odos API
     * @return actualOutputAmount Actual amount of output tokens received
     */
    function _executeOdosSwap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutputAmount,
        address target,
        bytes memory swapData
    ) internal returns (uint256 actualOutputAmount) {
        // Approve tokens to Odos router
        ERC20(inputToken).forceApprove(target, inputAmount);
        
        // Record output token balance before swap
        uint256 outputBalanceBefore = ERC20(outputToken).balanceOf(address(this));
        
        // Execute Odos swap
        (bool success, bytes memory result) = target.call(swapData);
        if (!success) {
            if (result.length > 0) {
                assembly {
                    let resultLength := mload(result)
                    revert(add(32, result), resultLength)
                }
            }
            revert OdosSwapFailed("Odos swap execution failed");
        }
        
        // Calculate actual output received
        uint256 outputBalanceAfter = ERC20(outputToken).balanceOf(address(this));
        actualOutputAmount = outputBalanceAfter - outputBalanceBefore;
        
        // Verify minimum output
        if (actualOutputAmount < minOutputAmount) {
            revert InsufficientOutputAfterSwap(minOutputAmount, actualOutputAmount);
        }
        
        return actualOutputAmount;
    }

    /**
     * @notice Helper function to check if a token is a PT token
     * @dev This can be used by external callers to determine if they should use this contract
     * @param token The token address to check
     * @return isPT True if the token appears to be a PT token
     */
    function isPTToken(address token) external view returns (bool isPT) {
        // Simple check - try to call expiry() method which PT tokens should have
        try this.checkPTInterface(token) returns (bool result) {
            return result;
        } catch {
            return false;
        }
    }

    /**
     * @notice External function to check PT interface (called by isPTToken)
     * @param token The token address to check
     * @return True if token implements PT interface
     */
    function checkPTInterface(address token) external view returns (bool) {
        // Try to call expiry() method - PT tokens should have this
        (bool success, ) = token.staticcall(abi.encodeWithSignature("expiry()"));
        return success;
    }

    /**
     * @notice Get the contract version for identification
     * @return version The version string
     */
    function version() external pure returns (string memory) {
        return "FlashLoanLiquidatorAaveBorrowRepayPTOdos-v1.0.0";
    }
} 