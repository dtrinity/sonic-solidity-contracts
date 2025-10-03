// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";

contract DusdHelperMock {
    using SafeERC20 for IERC20;

    error NotController(address sender, address expected);
    error LengthMismatch();

    IERC20 public immutable token;
    address public controller;

    constructor(IERC20 token_, address controller_) {
        token = token_;
        controller = controller_;
    }

    function setController(address newController) external {
        address current = controller;
        if (current != address(0) && msg.sender != current) {
            revert NotController(msg.sender, current);
        }
        controller = newController;
    }

    function forward(address to, uint256 amount) external {
        if (msg.sender != controller) {
            revert NotController(msg.sender, controller);
        }
        token.safeTransfer(to, amount);
    }

    function fanOut(address[] calldata recipients, uint256[] calldata amounts) external {
        if (msg.sender != controller) {
            revert NotController(msg.sender, controller);
        }
        if (recipients.length != amounts.length) {
            revert LengthMismatch();
        }
        for (uint256 i = 0; i < recipients.length; ++i) {
            token.safeTransfer(recipients[i], amounts[i]);
        }
    }
}
