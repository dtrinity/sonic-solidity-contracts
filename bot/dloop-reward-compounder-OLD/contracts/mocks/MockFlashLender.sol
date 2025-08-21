// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC3156FlashBorrower, IERC3156FlashLender } from "../interfaces/IERC3156.sol";
import { MockERC20 } from "./MockERC20.sol";

contract MockFlashLender is IERC3156FlashLender {
    MockERC20 public immutable token;
    uint256 public feeBps; // e.g., 9 = 0.09%

    constructor(address _token, uint256 _feeBps) {
        token = MockERC20(_token);
        feeBps = _feeBps;
    }

    function setFeeBps(uint256 bps) external { feeBps = bps; }

    function flashLoan(address receiver, address _token, uint256 amount, bytes calldata data) external returns (bool) {
        require(_token == address(token), "bad token");
        uint256 fee = flashFee(_token, amount);
        // Mint to this contract so we can transfer to borrower
        token.mint(address(this), amount);
        token.transfer(receiver, amount);
        bytes32 retval = IERC3156FlashBorrower(receiver).onFlashLoan(msg.sender, _token, amount, fee, data);
        require(retval == keccak256("ERC3156FlashBorrower.onFlashLoan"), "callback");
        // Pull back amount + fee
        token.transferFrom(receiver, address(this), amount + fee);
        return true;
    }

    function flashFee(address, uint256 amount) public view returns (uint256) {
        return (amount * feeBps) / 10_000;
    }
}

