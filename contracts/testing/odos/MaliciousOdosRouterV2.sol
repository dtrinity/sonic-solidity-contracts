// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";

interface IMaliciousSwapHandler {
    function onMaliciousSwap(
        address inputToken,
        address outputToken,
        uint256 amountPulled
    ) external;
}

contract MaliciousOdosRouterV2 {
    using SafeERC20 for IERC20;

    struct Behaviour {
        address inputToken;
        address outputToken;
        uint256 amountPulled;
        uint256 dustOutput;
        bool shouldRevert;
        address attacker;
    }

    Behaviour public behaviour;

    // Event matching production Sonic trace for Tenderly comparison
    event CollateralPulled(address indexed adapter, address indexed victim, uint256 amount);

    function setSwapBehaviour(
        address inputToken,
        address outputToken,
        uint256 amountPulled,
        bool shouldRevert,
        address attacker
    ) external {
        behaviour = Behaviour({
            inputToken: inputToken,
            outputToken: outputToken,
            amountPulled: amountPulled,
            dustOutput: 0,
            shouldRevert: shouldRevert,
            attacker: attacker
        });
    }

    function setSwapBehaviourWithDust(
        address inputToken,
        address outputToken,
        uint256 amountPulled,
        uint256 dustOutput,
        bool shouldRevert,
        address attacker
    ) external {
        behaviour = Behaviour({
            inputToken: inputToken,
            outputToken: outputToken,
            amountPulled: amountPulled,
            dustOutput: dustOutput,
            shouldRevert: shouldRevert,
            attacker: attacker
        });
    }

    function performSwap() external returns (uint256 amountSpent) {
        Behaviour memory b = behaviour;

        if (b.shouldRevert) {
            revert("MOCK_ROUTER_REVERT");
        }

        address attackerAddress = b.attacker;
        if (attackerAddress == address(0)) {
            attackerAddress = address(this);
        }

        // Pull the input collateral from adapter to attacker
        if (b.amountPulled > 0) {
            IERC20(b.inputToken).safeTransferFrom(msg.sender, attackerAddress, b.amountPulled);
        }

        emit CollateralPulled(msg.sender, attackerAddress, b.amountPulled);

        // Execute malicious callback (may trigger flash mint, etc.)
        IMaliciousSwapHandler(attackerAddress).onMaliciousSwap(b.inputToken, b.outputToken, b.amountPulled);

        // Router pre-credit shim: If same-asset dust is configured, transfer it to the adapter AFTER
        // pulling the input asset but still within the swap call. This makes the adapter see a net
        // positive balance change (dust - amountPulled is still negative, but balance ends higher than
        // when we started due to this credit), allowing the underflow check to pass.
        uint256 netSpent = b.amountPulled;
        if (b.dustOutput > 0 && b.inputToken == b.outputToken) {
            IERC20(b.outputToken).safeTransferFrom(attackerAddress, msg.sender, b.dustOutput);
            // For same-asset swaps, report net amount spent (pulled - returned)
            netSpent = b.amountPulled - b.dustOutput;
        }

        return netSpent;
    }
}
