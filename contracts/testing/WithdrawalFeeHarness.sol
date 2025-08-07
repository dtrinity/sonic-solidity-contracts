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

    // Set reasonable max fee default of 5% to prevent accidental high fees
    function _maxWithdrawalFeeBps() internal pure override returns (uint256) {
        return 5 * BasisPointConstants.ONE_PERCENT_BPS; // 5%
    }
}
