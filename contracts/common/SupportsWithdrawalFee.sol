// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BasisPointConstants.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

error InitialFeeExceedsMaxFee(uint256 feeBps, uint256 maxFeeBps);
error InvalidFeeBps(uint256 feeBps, uint256 maxFeeBps);

// Note: FeeManagerCannotBeZeroAddress error can be handled by the consuming contract's AccessControl checks.

abstract contract SupportsWithdrawalFee {
    uint256 internal withdrawalFeeBps_;

    event WithdrawalFee(address indexed owner, address indexed receiver, uint256 feeAmount);
    event WithdrawalFeeSet(uint256 newFeeBps);

    /**
     * @notice Must be implemented by the inheriting contract to define its specific maximum withdrawal fee in BPS.
     * @return The maximum withdrawal fee in basis points.
     */
    function _maxWithdrawalFeeBps() internal view virtual returns (uint256);

    /**
     * @notice Initialize the withdrawal fee during contract construction/initialization.
     * @param initialFeeBps The initial withdrawal fee in basis points.
     */
    function _initializeWithdrawalFee(uint256 initialFeeBps) internal {
        uint256 maxFee = _maxWithdrawalFeeBps();
        if (initialFeeBps > maxFee) {
            revert InitialFeeExceedsMaxFee(initialFeeBps, maxFee);
        }
        withdrawalFeeBps_ = initialFeeBps;
        emit WithdrawalFeeSet(initialFeeBps);
    }

    /**
     * @notice Set the withdrawal fee. Internal function to be called by the inheriting contract.
     * @param newFeeBps The new withdrawal fee in basis points.
     */
    function _setWithdrawalFee(uint256 newFeeBps) internal {
        uint256 maxFee = _maxWithdrawalFeeBps();
        if (newFeeBps > maxFee) {
            revert InvalidFeeBps(newFeeBps, maxFee);
        }
        withdrawalFeeBps_ = newFeeBps;
        emit WithdrawalFeeSet(newFeeBps);
    }

    /**
     * @notice Calculate the withdrawal fee for a given asset amount.
     * @dev Uses precise division since fees stay in the vault (no external transfer).
     * @param assetAmount The amount of assets being withdrawn.
     * @return The fee amount in asset terms.
     */
    function _calculateWithdrawalFee(uint256 assetAmount) internal view returns (uint256) {
        return Math.mulDiv(assetAmount, withdrawalFeeBps_, BasisPointConstants.ONE_HUNDRED_PERCENT_BPS);
    }

    /**
     * @notice Calculate the net amount after deducting withdrawal fees.
     * Used for previewRedeem to show what the user will actually receive.
     * @param grossAmount The gross amount before fees.
     * @return The net amount after deducting fees.
     */
    function _getNetAmountAfterFee(uint256 grossAmount) internal view returns (uint256) {
        uint256 fee = _calculateWithdrawalFee(grossAmount);
        return grossAmount - fee;
    }

    /**
     * @notice Calculate the gross amount required to achieve a desired net amount.
     * Used for previewWithdraw to show how many shares are needed for a desired net withdrawal.
     * @dev Uses precise division since fees stay in the vault.
     * @param netAmount The desired net amount after fees.
     * @return The gross amount required before fees.
     */
    function _getGrossAmountRequiredForNet(uint256 netAmount) internal view returns (uint256) {
        if (withdrawalFeeBps_ == 0) {
            return netAmount;
        }
        // grossAmount = netAmount / (1 - feeBps/ONE_HUNDRED_PERCENT_BPS)
        // grossAmount = netAmount * ONE_HUNDRED_PERCENT_BPS / (ONE_HUNDRED_PERCENT_BPS - feeBps)
        return
            Math.mulDiv(
                netAmount,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - withdrawalFeeBps_
            );
    }

    /**
     * @notice Get the current withdrawal fee in basis points.
     * @return The withdrawal fee in basis points.
     */
    function getWithdrawalFeeBps() public view returns (uint256) {
        return withdrawalFeeBps_;
    }
}
