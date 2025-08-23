// SPDX-License-Identifier: MIT
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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/common/BasisPointConstants.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title SimpleDEXMock
 * @notice A mock decentralized exchange contract for testing purposes
 * @dev This contract mimics DEX behavior with configurable exchange rates and execution slippage
 */
contract SimpleDEXMock {
    using SafeERC20 for IERC20;

    // State variables
    mapping(address => mapping(address => uint256)) public exchangeRates; // inputToken => outputToken => rate (in 18 decimals)
    uint256 public executionSlippageBps; // Execution slippage in basis points

    // Events
    event ExchangeRateSet(address indexed inputToken, address indexed outputToken, uint256 rate);
    event ExecutionSlippageSet(uint256 slippageBps);
    event SwapExecuted(
        address indexed inputToken,
        address indexed outputToken,
        uint256 amountIn,
        uint256 amountOut,
        address indexed receiver,
        string swapType
    );

    // Errors
    error ZeroAddress();
    error ZeroAmount();
    error ExchangeRateNotSet();
    error InsufficientOutputAmount(uint256 actual, uint256 minimum);
    error ExcessiveInputAmount(uint256 actual, uint256 maximum);
    error InsufficientBalance(address token, uint256 requested, uint256 available);
    error InsufficientAllowance(address token, uint256 requested, uint256 available);
    error TransferFailed();

    /**
     * @notice Constructor
     */
    constructor() {
        executionSlippageBps = 0; // Default no execution slippage
    }

    /**
     * @notice Set exchange rate for a token pair
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param rate The exchange rate (how much outputToken per 1 inputToken, in 18 decimals)
     */
    function setExchangeRate(address inputToken, address outputToken, uint256 rate) external {
        if (inputToken == address(0) || outputToken == address(0)) {
            revert ZeroAddress();
        }
        if (rate == 0) {
            revert ZeroAmount();
        }

        exchangeRates[inputToken][outputToken] = rate;
        emit ExchangeRateSet(inputToken, outputToken, rate);
    }

    /**
     * @notice Set execution slippage in basis points
     * @param slippageBps The execution slippage (e.g., 20000 = 2%)
     */
    function setExecutionSlippage(uint256 slippageBps) external {
        if (slippageBps >= BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert("Execution slippage cannot be 100% or more");
        }
        executionSlippageBps = slippageBps;
        emit ExecutionSlippageSet(slippageBps);
    }

    /**
     * @notice Execute swap with exact input amount
     * @param inputToken The input token to swap from
     * @param outputToken The output token to swap to
     * @param amountIn The exact amount of input tokens to swap
     * @param amountOutMinimum The minimum amount of output tokens expected
     * @param receiver The address to receive the output tokens
     * @return amountOut The actual amount of output tokens transferred
     */
    function executeSwapExactInput(
        IERC20Metadata inputToken,
        IERC20Metadata outputToken,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address receiver
    ) external returns (uint256 amountOut) {
        if (address(inputToken) == address(0) || address(outputToken) == address(0)) {
            revert ZeroAddress();
        }
        if (receiver == address(0)) {
            revert ZeroAddress();
        }
        if (amountIn == 0) {
            revert ZeroAmount();
        }

        // Check exchange rate exists
        uint256 rate = exchangeRates[address(inputToken)][address(outputToken)];
        if (rate == 0) {
            revert ExchangeRateNotSet();
        }

        // Check allowance
        uint256 allowance = inputToken.allowance(msg.sender, address(this));
        if (allowance < amountIn) {
            revert InsufficientAllowance(address(inputToken), amountIn, allowance);
        }

        // Calculate output amount before slippage
        uint256 outputBeforeSlippage = _calculateOutputAmount(
            amountIn,
            rate,
            inputToken.decimals(),
            outputToken.decimals()
        );

        // Apply execution slippage
        amountOut = _applyExecutionSlippage(outputBeforeSlippage);

        // Check minimum output
        if (amountOut < amountOutMinimum) {
            revert InsufficientOutputAmount(amountOut, amountOutMinimum);
        }

        // Check contract has enough output tokens
        uint256 contractBalance = outputToken.balanceOf(address(this));
        if (contractBalance < amountOut) {
            revert InsufficientBalance(address(outputToken), amountOut, contractBalance);
        }

        // Execute the swap
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(outputToken).safeTransfer(receiver, amountOut);

        emit SwapExecuted(address(inputToken), address(outputToken), amountIn, amountOut, receiver, "ExactInput");

        return amountOut;
    }

    /**
     * @notice Execute swap with exact output amount
     * @param inputToken The input token to swap from
     * @param outputToken The output token to swap to
     * @param amountOut The exact amount of output tokens to receive
     * @param amountInMaximum The maximum amount of input tokens to spend
     * @param receiver The address to receive the output tokens
     * @return amountIn The actual amount of input tokens spent
     */
    function executeSwapExactOutput(
        IERC20Metadata inputToken,
        IERC20Metadata outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver
    ) external returns (uint256 amountIn) {
        if (address(inputToken) == address(0) || address(outputToken) == address(0)) {
            revert ZeroAddress();
        }
        if (receiver == address(0)) {
            revert ZeroAddress();
        }
        if (amountOut == 0) {
            revert ZeroAmount();
        }

        // Check exchange rate exists
        uint256 rate = exchangeRates[address(inputToken)][address(outputToken)];
        if (rate == 0) {
            revert ExchangeRateNotSet();
        }

        // Check contract has enough output tokens
        uint256 contractBalance = outputToken.balanceOf(address(this));
        if (contractBalance < amountOut) {
            revert InsufficientBalance(address(outputToken), amountOut, contractBalance);
        }

        // Calculate required input amount considering execution slippage
        // We need to calculate how much input is needed to get amountOut after slippage
        uint256 amountOutBeforeSlippage = _reverseExecutionSlippage(amountOut);

        amountIn = _calculateInputAmount(amountOutBeforeSlippage, rate, inputToken.decimals(), outputToken.decimals());

        // Check maximum input
        if (amountIn > amountInMaximum) {
            revert ExcessiveInputAmount(amountIn, amountInMaximum);
        }

        // Check allowance
        uint256 allowance = inputToken.allowance(msg.sender, address(this));
        if (allowance < amountIn) {
            revert InsufficientAllowance(address(inputToken), amountIn, allowance);
        }

        // Execute the swap
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(outputToken).safeTransfer(receiver, amountOut);

        emit SwapExecuted(address(inputToken), address(outputToken), amountIn, amountOut, receiver, "ExactOutput");

        return amountIn;
    }

    /**
     * @notice Get the exchange rate for a token pair
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @return rate The exchange rate (18 decimals)
     */
    function getExchangeRate(address inputToken, address outputToken) external view returns (uint256 rate) {
        return exchangeRates[inputToken][outputToken];
    }

    /**
     * @notice Preview output amount for exact input swap
     * @param inputToken The input token
     * @param outputToken The output token
     * @param amountIn The input amount
     * @return amountOut The expected output amount (after execution slippage)
     */
    function previewSwapExactInput(
        IERC20Metadata inputToken,
        IERC20Metadata outputToken,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        uint256 rate = exchangeRates[address(inputToken)][address(outputToken)];
        if (rate == 0) {
            return 0;
        }

        uint256 outputBeforeSlippage = _calculateOutputAmount(
            amountIn,
            rate,
            inputToken.decimals(),
            outputToken.decimals()
        );

        return _applyExecutionSlippage(outputBeforeSlippage);
    }

    /**
     * @notice Preview input amount for exact output swap
     * @param inputToken The input token
     * @param outputToken The output token
     * @param amountOut The output amount
     * @return amountIn The expected input amount required
     */
    function previewSwapExactOutput(
        IERC20Metadata inputToken,
        IERC20Metadata outputToken,
        uint256 amountOut
    ) external view returns (uint256 amountIn) {
        uint256 rate = exchangeRates[address(inputToken)][address(outputToken)];
        if (rate == 0) {
            return 0;
        }

        uint256 amountOutBeforeSlippage = _reverseExecutionSlippage(amountOut);

        return _calculateInputAmount(amountOutBeforeSlippage, rate, inputToken.decimals(), outputToken.decimals());
    }

    /**
     * @notice Calculate output amount from input amount and rate
     * @param amountIn The input amount
     * @param rate The exchange rate (18 decimals)
     * @param inputDecimals The input token decimals
     * @param outputDecimals The output token decimals
     * @return outputAmount The calculated output amount
     */
    function _calculateOutputAmount(
        uint256 amountIn,
        uint256 rate,
        uint8 inputDecimals,
        uint8 outputDecimals
    ) internal pure returns (uint256 outputAmount) {
        // Convert input to 18 decimals for calculation
        uint256 normalizedInput = amountIn;
        if (inputDecimals < 18) {
            normalizedInput = amountIn * (10 ** (18 - inputDecimals));
        } else if (inputDecimals > 18) {
            normalizedInput = amountIn / (10 ** (inputDecimals - 18));
        }

        // Calculate output in 18 decimals: input * rate / 1e18
        uint256 normalizedOutput = (normalizedInput * rate) / 1e18;

        // Convert output to token decimals
        if (outputDecimals < 18) {
            outputAmount = normalizedOutput / (10 ** (18 - outputDecimals));
        } else if (outputDecimals > 18) {
            outputAmount = normalizedOutput * (10 ** (outputDecimals - 18));
        } else {
            outputAmount = normalizedOutput;
        }

        return outputAmount;
    }

    /**
     * @notice Calculate input amount from output amount and rate
     * @param amountOut The output amount
     * @param rate The exchange rate (18 decimals)
     * @param inputDecimals The input token decimals
     * @param outputDecimals The output token decimals
     * @return inputAmount The calculated input amount
     */
    function _calculateInputAmount(
        uint256 amountOut,
        uint256 rate,
        uint8 inputDecimals,
        uint8 outputDecimals
    ) internal pure returns (uint256 inputAmount) {
        // Convert output to 18 decimals for calculation
        uint256 normalizedOutput = amountOut;
        if (outputDecimals < 18) {
            normalizedOutput = amountOut * (10 ** (18 - outputDecimals));
        } else if (outputDecimals > 18) {
            normalizedOutput = amountOut / (10 ** (outputDecimals - 18));
        }

        // Calculate input in 18 decimals: output * 1e18 / rate
        uint256 normalizedInput = (normalizedOutput * 1e18) / rate;

        // Convert input to token decimals
        if (inputDecimals < 18) {
            inputAmount = normalizedInput / (10 ** (18 - inputDecimals));
        } else if (inputDecimals > 18) {
            inputAmount = normalizedInput * (10 ** (inputDecimals - 18));
        } else {
            inputAmount = normalizedInput;
        }

        return inputAmount;
    }

    /**
     * @notice Apply execution slippage to reduce output amount
     * @param amount The original amount
     * @return slippedAmount The amount after applying execution slippage
     */
    function _applyExecutionSlippage(uint256 amount) internal view returns (uint256 slippedAmount) {
        if (executionSlippageBps == 0) {
            return amount;
        }

        // Reduce by execution slippage: amount * (100% - slippage%) / 100%
        slippedAmount = Math.mulDiv(
            amount,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - executionSlippageBps,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
        );

        return slippedAmount;
    }

    /**
     * @notice Reverse execution slippage to calculate required amount before slippage
     * @param targetAmount The target amount after slippage
     * @return originalAmount The amount needed before slippage
     */
    function _reverseExecutionSlippage(uint256 targetAmount) internal view returns (uint256 originalAmount) {
        if (executionSlippageBps == 0) {
            return targetAmount;
        }

        // Calculate original amount: targetAmount * 100% / (100% - slippage%)
        originalAmount = Math.mulDiv(
            targetAmount,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - executionSlippageBps
        );

        return originalAmount;
    }

    /**
     * @notice Emergency function to withdraw tokens (for testing purposes)
     * @param token The token to withdraw
     * @param amount The amount to withdraw
     * @param to The recipient address
     */
    function emergencyWithdraw(IERC20 token, uint256 amount, address to) external {
        if (to == address(0)) {
            revert ZeroAddress();
        }
        token.safeTransfer(to, amount);
    }
}
