// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MockERC20 } from "./MockERC20.sol";

// Calldata format (abi.encode(expectedOut, maxIn)) to simulate exact-out
contract MockOdosRouter {
    MockERC20 public immutable inToken;  // dUSD
    MockERC20 public immutable outToken; // collateral
    bool public underfill;
    bool public forceRevert;

    constructor(address _in, address _out) { inToken = MockERC20(_in); outToken = MockERC20(_out); }

    function setBehaviors(bool _underfill, bool _forceRevert) external { underfill = _underfill; forceRevert = _forceRevert; }

    fallback() external payable {
        if (forceRevert) revert("venue revert");
        (uint256 expectedOut, uint256 maxIn) = abi.decode(msg.data, (uint256, uint256));
        uint256 toSpend = maxIn; // spend all available for simplicity
        require(inToken.transferFrom(msg.sender, address(this), toSpend), "pull in");
        uint256 out = underfill ? expectedOut - 1 : expectedOut;
        outToken.mint(msg.sender, out);
    }
}

