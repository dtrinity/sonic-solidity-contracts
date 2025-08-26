// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/common/Compare.sol";

contract CompareHarness {
    function isWithinTolerancePublic(
        uint256 observed,
        uint256 expected,
        uint256 tolerance
    ) external pure returns (bool) {
        return Compare.isWithinTolerance(observed, expected, tolerance);
    }

    function checkBalanceDeltaPublic(
        uint256 beforeBalance,
        uint256 afterBalance,
        uint256 expectedDelta,
        uint256 tolerance,
        Compare.BalanceDirection direction
    ) external pure returns (bool directionOk, uint256 observedDelta, bool toleranceOk) {
        Compare.BalanceCheckResult memory result = Compare.checkBalanceDelta(
            beforeBalance,
            afterBalance,
            expectedDelta,
            tolerance,
            direction
        );
        return (result.directionOk, result.observedDelta, result.toleranceOk);
    }
}
