// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";
import {DLoopCoreBase} from "../../core/DLoopCoreBase.sol";
import {SharedLogic} from "./SharedLogic.sol";

/**
 * @title DLoopRedeemerLogic
 * @dev Pure/view logic extracted from `DLoopRedeemerBase`
 */
library DLoopRedeemerLogic {
    error SlippageBpsCannotExceedOneHundredPercent(uint256 slippageBps);
    error SharesNotDecreasedAfterFlashLoan(
        uint256 sharesBeforeWithdraw,
        uint256 sharesAfterWithdraw
    );
    error IncorrectSharesBurned(uint256 expected, uint256 actual);

    /**
     * @dev Calculates the minimum output collateral amount for a given shares and slippage bps
     */
    function calculateMinOutputCollateral(
        uint256 shares,
        uint256 slippageBps,
        DLoopCoreBase dLoopCore
    ) internal view returns (uint256) {
        if (slippageBps > BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert SlippageBpsCannotExceedOneHundredPercent(slippageBps);
        }
        uint256 expectedLeverageCollateral = dLoopCore.previewRedeem(shares);
        uint256 unleveragedCollateral = SharedLogic.getUnleveragedAssets(
            expectedLeverageCollateral,
            dLoopCore
        );
        return
            Math.mulDiv(
                unleveragedCollateral,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - slippageBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );
    }

    /**
     * @dev Encodes flash loan parameters to data
     */
    function encodeFlashLoanParams(
        uint256 shares,
        bytes memory collateralToDebtTokenSwapData,
        DLoopCoreBase dLoopCore
    ) internal pure returns (bytes memory data) {
        data = abi.encode(shares, collateralToDebtTokenSwapData, dLoopCore);
    }

    /**
     * @dev Decodes data to flash loan parameters (tuple form)
     */
    function decodeFlashLoanParams(
        bytes memory data
    )
        internal
        pure
        returns (
            uint256 shares,
            bytes memory collateralToDebtTokenSwapData,
            DLoopCoreBase dLoopCore
        )
    {
        (shares, collateralToDebtTokenSwapData, dLoopCore) = abi.decode(
            data,
            (uint256, bytes, DLoopCoreBase)
        );
    }

    /**
     * @dev Validates that shares were burned correctly
     */
    function validateSharesBurned(
        DLoopCoreBase dLoopCore,
        address owner,
        uint256 shares,
        uint256 sharesBeforeRedeem
    ) internal view {
        uint256 sharesAfterRedeem = dLoopCore.balanceOf(owner);
        if (sharesAfterRedeem >= sharesBeforeRedeem) {
            revert SharesNotDecreasedAfterFlashLoan(
                sharesBeforeRedeem,
                sharesAfterRedeem
            );
        }
        uint256 actualBurnedShares = sharesBeforeRedeem - sharesAfterRedeem;
        if (actualBurnedShares != shares) {
            revert IncorrectSharesBurned(shares, actualBurnedShares);
        }
    }
}
