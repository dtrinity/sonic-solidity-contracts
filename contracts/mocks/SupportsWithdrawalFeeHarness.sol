// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SupportsWithdrawalFee } from "../common/SupportsWithdrawalFee.sol";

contract SupportsWithdrawalFeeHarness is SupportsWithdrawalFee {
    uint256 internal constant MAX_FEE_BPS = 100_00;

    constructor(uint256 initialFeeBps) {
        _initializeWithdrawalFee(initialFeeBps);
    }

    function _maxWithdrawalFeeBps() internal pure override returns (uint256) {
        return MAX_FEE_BPS;
    }

    function setWithdrawalFeeBps(uint256 newFeeBps) external {
        _setWithdrawalFee(newFeeBps);
    }

    function getNetAmountAfterFee(uint256 grossAmount) external view returns (uint256) {
        return _getNetAmountAfterFee(grossAmount);
    }

    function getGrossAmountRequiredForNet(uint256 netAmount) external view returns (uint256) {
        return _getGrossAmountRequiredForNet(netAmount);
    }
}
