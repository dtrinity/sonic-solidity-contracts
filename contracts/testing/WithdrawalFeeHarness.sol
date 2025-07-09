// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/common/SupportsWithdrawalFee.sol";

contract WithdrawalFeeHarness is SupportsWithdrawalFee {
    constructor(uint256 initialFeeBps) {
        _initializeWithdrawalFee(initialFeeBps);
    }

    function calc(uint256 amount) external view returns (uint256) {
        return _calculateWithdrawalFee(amount);
    }

    // Set high max fee BPS to avoid revert in initialization during tests
    function _maxWithdrawalFeeBps() internal pure override returns (uint256) {
        return 1_000_000; // 100%
    }
}
