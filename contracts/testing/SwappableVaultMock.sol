// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { SwappableVault } from "../common/SwappableVault.sol";
import { IMintableERC20 } from "../common/IMintableERC20.sol";

/**
 * @title SwappableVaultMock
 * @dev Mock implementation of SwappableVault for testing purposes
 */
contract SwappableVaultMock is SwappableVault {
    uint256 private _amountInToReturn;
    uint256 private _amountInToActuallySpend;
    uint256 private _amountOutToActuallyMint;
    bool private _shouldRevert;
    string private _revertMessage;

    /**
     * @dev Set the amount in that will be returned by the swap implementation
     */
    function setAmountInToReturn(uint256 amountIn) external {
        _amountInToReturn = amountIn;
        _amountInToActuallySpend = amountIn; // Default to same amount
        _amountOutToActuallyMint = 0; // Will use amountOut parameter
    }

    /**
     * @dev Set different amounts for return vs actual spend to test tolerance
     */
    function setAmountInParams(uint256 amountInToReturn, uint256 amountInToActuallySpend) external {
        _amountInToReturn = amountInToReturn;
        _amountInToActuallySpend = amountInToActuallySpend;
        _amountOutToActuallyMint = 0; // Will use amountOut parameter
    }

    /**
     * @dev Set different amount out to actually mint for testing output validation
     */
    function setAmountOutToMint(uint256 amountOutToMint) external {
        _amountOutToActuallyMint = amountOutToMint;
    }

    /**
     * @dev Set whether the swap implementation should revert
     */
    function setShouldRevert(bool shouldRevert, string memory revertMessage) external {
        _shouldRevert = shouldRevert;
        _revertMessage = revertMessage;
    }

    /**
     * @dev Mock implementation that simulates a swap by transferring tokens
     */
    function _swapExactOutputImplementation(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256, // amountInMaximum
        address, // receiver
        uint256, // deadline
        bytes memory // extraData
    ) internal override returns (uint256) {
        if (_shouldRevert) {
            revert(_revertMessage);
        }

        // Transfer input tokens from this contract to simulate spending
        // We'll use _amountInToActuallySpend as the actual amount spent
        uint256 actualSpent = _amountInToActuallySpend;
        if (actualSpent > 0 && inputToken.balanceOf(address(this)) >= actualSpent) {
            inputToken.transfer(address(0xdead), actualSpent); // Burn tokens to simulate spending
        }

        // For output tokens, we need to ensure the balance increases correctly
        // Instead of transferring to receiver directly, we'll mint new tokens to this contract
        // to simulate receiving tokens from a swap, then the balance increase will be detected
        uint256 actualAmountOut = _amountOutToActuallyMint > 0 ? _amountOutToActuallyMint : amountOut;
        if (actualAmountOut > 0) {
            // Mint tokens to this contract to simulate receiving them from swap
            IMintableERC20(address(outputToken)).mint(address(this), actualAmountOut);
        }

        return _amountInToReturn;
    }

    /**
     * @dev Public wrapper to test the _swapExactOutput function
     */
    function swapExactOutput(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256 deadline,
        bytes memory extraData
    ) external returns (uint256) {
        return _swapExactOutput(inputToken, outputToken, amountOut, amountInMaximum, receiver, deadline, extraData);
    }

    /**
     * @dev Helper function to get the tolerance constant
     */
    function getBalanceDiffTolerance() external pure returns (uint256) {
        return BALANCE_DIFF_TOLERANCE;
    }
}
