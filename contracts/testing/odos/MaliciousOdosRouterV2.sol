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
        bool shouldRevert;
        address attacker;
    }

    Behaviour public behaviour;

    event CollateralPulled(address indexed adapter, address indexed attacker, uint256 amount);

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

        if (b.amountPulled > 0) {
            IERC20(b.inputToken).safeTransferFrom(msg.sender, attackerAddress, b.amountPulled);
        }

        emit CollateralPulled(msg.sender, attackerAddress, b.amountPulled);

        IMaliciousSwapHandler(attackerAddress).onMaliciousSwap(b.inputToken, b.outputToken, b.amountPulled);

        return b.amountPulled;
    }
}
