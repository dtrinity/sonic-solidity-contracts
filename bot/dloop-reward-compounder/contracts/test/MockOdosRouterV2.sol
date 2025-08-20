// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interface/IERC20.sol";

contract MockOdosRouterV2 {
    // simple rate and slippage bounds for testing
    // output = amountIn * rateBps / 10000
    uint256 public rateBps;
    IERC20 public immutable inputToken;
    IERC20 public immutable outputToken;

    constructor(IERC20 _input, IERC20 _output, uint256 _rateBps) {
        inputToken = _input;
        outputToken = _output;
        rateBps = _rateBps; // e.g., 9990 => 0.1% loss
    }

    function setRateBps(uint256 v) external { rateBps = v; }

    // Swap function signature used via low-level call
    function swapExactIn(address input, address output, uint256 amountIn, uint256 minOut) external returns (uint256 actualOut) {
        require(input == address(inputToken) && output == address(outputToken), "bad pair");
        // pull tokens from caller
        require(inputToken.transferFrom(msg.sender, address(this), amountIn), "pull in");
        actualOut = (amountIn * rateBps) / 10000;
        require(actualOut >= minOut, "slippage");
        require(outputToken.transfer(msg.sender, actualOut), "push out");
    }
}

