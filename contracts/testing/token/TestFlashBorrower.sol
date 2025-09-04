// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TestFlashBorrower is IERC3156FlashBorrower {
    using SafeERC20 for IERC20;

    function onFlashLoan(
        address, // initiator
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata // data
    ) external override returns (bytes32) {
        // Approve the token contract to take back the loan + fee
        IERC20(token).forceApprove(msg.sender, amount + fee);

        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}
