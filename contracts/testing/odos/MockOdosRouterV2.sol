// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockOdosRouterV2
/// @notice Very light-weight mock that emulates the minimal behaviour that the production contracts rely on:
///  – Taking an allowance via `transferFrom` for the *actual* amount spent (configured)
///  – Sending the configured output tokens to the caller
///  – Returning the amount spent as a single uint256 word (encoded) so that
///    `OdosSwapUtils.executeSwapOperation()` can `mload` it.
/// The contract does **not** attempt to replicate the real Odos router API. Tests encode a call to
/// `performSwap()` and pass the resulting `bytes` as `swapData` for the low-level call used by the library.
contract MockOdosRouterV2 {
    struct Behaviour {
        address inputToken;
        address outputToken;
        uint256 amountSpent;
        uint256 amountReceived;
        bool shouldRevert;
    }

    Behaviour public behaviour;

    /// @notice Configure the next swap behaviour
    function setSwapBehaviour(
        address _inputToken,
        address _outputToken,
        uint256 _amountSpent,
        uint256 _amountReceived,
        bool _shouldRevert
    ) external {
        behaviour = Behaviour({
            inputToken: _inputToken,
            outputToken: _outputToken,
            amountSpent: _amountSpent,
            amountReceived: _amountReceived,
            shouldRevert: _shouldRevert
        });
    }

    /// @notice Called via low-level `.call(swapData)` in tests
    /// @dev Signature deliberately simple – no parameters needed because behaviour is pre-configured.
    /// @return amountSpent The value configured in `setSwapBehaviour()`
    function performSwap() external returns (uint256 amountSpent) {
        Behaviour memory b = behaviour;

        if (b.shouldRevert) revert("MOCK_ROUTER_REVERT");

        // Pull input tokens from the caller and send output tokens back
        if (b.amountSpent > 0) {
            IERC20(b.inputToken).transferFrom(msg.sender, address(this), b.amountSpent);
        }
        if (b.amountReceived > 0) {
            IERC20(b.outputToken).transfer(msg.sender, b.amountReceived);
        }

        return b.amountSpent;
    }
}
