// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BasisPointConstants } from "./BasisPointConstants.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

library WithdrawalFeeMath {
    uint256 internal constant _SCALE = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

    function calculateWithdrawalFee(uint256 grossAmount, uint256 feeBps) internal pure returns (uint256) {
        if (grossAmount == 0 || feeBps == 0) {
            return 0;
        }
        if (feeBps >= _SCALE) {
            return grossAmount;
        }
        return Math.mulDiv(grossAmount, feeBps, _SCALE);
    }

    function netAfterFee(uint256 grossAmount, uint256 feeBps) internal pure returns (uint256) {
        if (grossAmount == 0) {
            return 0;
        }
        if (feeBps == 0) {
            return grossAmount;
        }
        if (feeBps >= _SCALE) {
            return 0;
        }

        uint256 fee = calculateWithdrawalFee(grossAmount, feeBps);
        if (fee >= grossAmount) {
            return 0;
        }
        return grossAmount - fee;
    }

    function grossFromNet(uint256 netAmount, uint256 feeBps) internal pure returns (uint256) {
        if (netAmount == 0 || feeBps == 0) {
            return netAmount;
        }
        if (feeBps >= _SCALE) {
            return 0;
        }

        uint256 grossAmount = Math.mulDiv(netAmount, _SCALE, _SCALE - feeBps, Math.Rounding.Ceil);

        if (grossAmount > 0) {
            uint256 alternativeNet = netAfterFee(grossAmount - 1, feeBps);
            if (alternativeNet >= netAmount) {
                grossAmount -= 1;
            }
        }

        return grossAmount;
    }
}
