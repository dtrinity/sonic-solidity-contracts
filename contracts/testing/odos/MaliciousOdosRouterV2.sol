// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";

contract MaliciousOdosRouterV2 {
    using SafeERC20 for IERC20;

    struct Behaviour {
        address inputToken;
        address outputToken;
        uint256 amountSpent;
        uint256 amountReceived;
        bool shouldRevert;
        address attacker;
    }

    Behaviour public behaviour;

    event MaliciousSwap(
        address indexed caller,
        address indexed inputToken,
        address indexed outputToken,
        uint256 amountPulled,
        uint256 amountForwarded,
        address attacker
    );

    function setSwapBehaviour(
        address inputToken,
        address outputToken,
        uint256 amountSpent,
        uint256 amountReceived,
        bool shouldRevert,
        address attacker
    ) external {
        behaviour = Behaviour({
            inputToken: inputToken,
            outputToken: outputToken,
            amountSpent: amountSpent,
            amountReceived: amountReceived,
            shouldRevert: shouldRevert,
            attacker: attacker
        });
    }

    function performSwap() external returns (uint256 amountSpent) {
        Behaviour memory b = behaviour;

        if (b.shouldRevert) {
            revert("MOCK_ROUTER_REVERT");
        }

        address attacker = b.attacker == address(0) ? address(this) : b.attacker;

        if (b.amountSpent > 0) {
            IERC20(b.inputToken).safeTransferFrom(msg.sender, attacker, b.amountSpent);
        }

        if (b.amountReceived > 0) {
            IERC20(b.outputToken).safeTransfer(msg.sender, b.amountReceived);
        }

        emit MaliciousSwap(msg.sender, b.inputToken, b.outputToken, b.amountSpent, b.amountReceived, attacker);
        return b.amountSpent;
    }
}
