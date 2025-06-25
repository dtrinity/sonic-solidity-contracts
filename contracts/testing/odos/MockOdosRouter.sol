pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockOdosRouter
 * @notice Extremely simplified mock for the Odos V2 router – **only** the function
 *         needed by the tests is implemented. It deliberately returns the *output*
 *         token amount instead of the *input* token amount to mimic the behaviour
 *         of the real Odos router that triggers the mismatch in `SwappableVault`.
 */
contract MockOdosRouter {
    /**
     * @dev Executes a fake swap that:
     *      1. Pulls `amountOut * 2` of `inputToken` from the caller (simulates spending input).
     *      2. Transfers exactly `amountOut` of `outputToken` to the caller.
     *      3. Returns the output amount (mirroring Odos behaviour).
     *
     * This creates the condition `spentInputTokenAmount != returnedAmountIn` that
     * triggers the revert in `SwappableVault._swapExactOutput`.
     */
    function swapExactOutput(
        address inputToken,
        address outputToken,
        uint256 amountOut
    ) external returns (uint256) {
        uint256 amountIn = amountOut * 2;

        // Pull the input tokens from the caller (they approved us beforehand).
        ERC20(inputToken).transferFrom(msg.sender, address(this), amountIn);

        // Send the requested output tokens to the caller.
        ERC20(outputToken).transfer(msg.sender, amountOut);

        // Mimic Odos: return the *output* amount, NOT the input spent.
        return amountOut;
    }

    // Allow receiving native tokens in case tests fund the router.
    receive() external payable {}
}
