// SPDX-License-Identifier: MIT
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

library Compare {
    /**
     * @dev Returns true if observed and expected differ by no more than the tolerance (absolute comparison).
     *      This is useful for allowing small rounding differences (e.g., 1 wei) in balance deltas.
     * @param observed The observed value (e.g., balance delta actually seen)
     * @param expected The expected value
     * @param tolerance The allowed absolute difference between observed and expected
     */
    function isWithinTolerance(uint256 observed, uint256 expected, uint256 tolerance) internal pure returns (bool) {
        if (observed > expected) {
            return observed - expected <= tolerance;
        }
        return expected - observed <= tolerance;
    }

    /**
     * @dev Direction of expected balance change between two observations
     */
    enum BalanceDirection {
        Increase,
        Decrease
    }

    struct BalanceCheckResult {
        bool directionOk;
        uint256 observedDelta;
        bool toleranceOk;
    }

    /**
     * @dev Checks a balance change from before to after against an expected delta and tolerance.
     *      This helper allows callers to keep custom error types local while sharing the core logic.
     * @param beforeBalance The balance before the operation
     * @param afterBalance The balance after the operation
     * @param expectedDelta The expected absolute change amount
     * @param tolerance The allowed absolute difference between observed and expected
     * @param direction The expected direction of change (Increase or Decrease)
     * @return result Struct containing: directionOk, observedDelta, toleranceOk
     */
    function checkBalanceDelta(
        uint256 beforeBalance,
        uint256 afterBalance,
        uint256 expectedDelta,
        uint256 tolerance,
        BalanceDirection direction
    ) internal pure returns (BalanceCheckResult memory result) {
        if (direction == BalanceDirection.Increase) {
            result.directionOk = afterBalance > beforeBalance;
            if (result.directionOk) {
                result.observedDelta = afterBalance - beforeBalance;
            }
        } else {
            result.directionOk = afterBalance < beforeBalance;
            if (result.directionOk) {
                result.observedDelta = beforeBalance - afterBalance;
            }
        }

        if (!result.directionOk) {
            // Short-circuit: when direction is not satisfied, tolerance check is irrelevant
            result.toleranceOk = false;
            return result;
        }

        result.toleranceOk = isWithinTolerance(result.observedDelta, expectedDelta, tolerance);
        return result;
    }
}
