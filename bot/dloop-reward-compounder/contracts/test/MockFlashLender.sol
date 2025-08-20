// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC3156FlashLender} from "../interface/IERC3156FlashLender.sol";
import {IERC3156FlashBorrower} from "../interface/IERC3156FlashBorrower.sol";
import {IERC20} from "../interface/IERC20.sol";

contract MockFlashLender is IERC3156FlashLender {
    IERC20 public immutable token;
    uint256 public feeBps;

    constructor(IERC20 _token, uint256 _feeBps) {
        token = _token;
        feeBps = _feeBps;
    }

    function maxFlashLoan(address _token) external view returns (uint256) {
        return _token == address(token) ? type(uint256).max : 0;
    }

    function flashFee(address _token, uint256 amount) public view returns (uint256) {
        require(_token == address(token), "bad token");
        return (amount * feeBps) / 10000;
    }

    function flashLoan(
        address receiver,
        address _token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool) {
        require(_token == address(token), "bad token");
        uint256 fee = flashFee(_token, amount);
        // send funds
        require(token.transfer(receiver, amount), "transfer failed");
        // callback
        bytes32 ret = IERC3156FlashBorrower(receiver).onFlashLoan(
            msg.sender,
            _token,
            amount,
            fee,
            data
        );
        require(ret == keccak256("ERC3156FlashBorrower.onFlashLoan"), "bad ret");
        // pull repayment
        require(token.transferFrom(receiver, address(this), amount + fee), "repay failed");
        return true;
    }
}

