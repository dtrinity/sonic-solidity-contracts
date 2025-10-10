// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/common/WithdrawalFeeMath.sol";

contract WithdrawalFeeHarness {
    function calculate(uint256 grossAmount, uint256 feeBps) external pure returns (uint256) {
        return WithdrawalFeeMath.calculateWithdrawalFee(grossAmount, feeBps);
    }

    function netAfterFee(uint256 grossAmount, uint256 feeBps) external pure returns (uint256) {
        return WithdrawalFeeMath.netAfterFee(grossAmount, feeBps);
    }

    function grossFromNet(uint256 netAmount, uint256 feeBps) external pure returns (uint256) {
        return WithdrawalFeeMath.grossFromNet(netAmount, feeBps);
    }
}
