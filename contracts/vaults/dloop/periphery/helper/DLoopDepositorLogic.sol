// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";
import {DLoopCoreBase} from "../../core/DLoopCoreBase.sol";
import {SharedLogic} from "./SharedLogic.sol";

/**
 * @title DLoopDepositorLogic
 * @dev Pure/view logic extracted from `DLoopDepositorBase`
 */
library DLoopDepositorLogic {
    /* Errors (same signatures as in Base) */
    error SlippageBpsCannotExceedOneHundredPercent(uint256 slippageBps);
    error EstimatedSharesLessThanMinOutputShares(
        uint256 currentEstimatedShares,
        uint256 minOutputShares
    );
    error LeveragedCollateralAmountLessThanDepositCollateralAmount(
        uint256 leveragedCollateralAmount,
        uint256 depositCollateralAmount
    );

    /**
     * @dev Calculates the minimum output shares for a given deposit amount and slippage bps
     */
    function calculateMinOutputShares(
        uint256 depositAmount,
        uint256 slippageBps,
        DLoopCoreBase dLoopCore
    ) internal view returns (uint256) {
        if (slippageBps > BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert SlippageBpsCannotExceedOneHundredPercent(slippageBps);
        }
        uint256 expectedLeveragedAssets = SharedLogic.getLeveragedAssets(
            depositAmount,
            dLoopCore
        );
        uint256 expectedShares = dLoopCore.convertToShares(
            expectedLeveragedAssets
        );
        return
            Math.mulDiv(
                expectedShares,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - slippageBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );
    }

    /**
     * @dev Calculates the estimated overall slippage bps
     */
    function calculateEstimatedOverallSlippageBps(
        uint256 currentEstimatedShares,
        uint256 minOutputShares
    ) internal pure returns (uint256) {
        if (currentEstimatedShares < minOutputShares) {
            revert EstimatedSharesLessThanMinOutputShares(
                currentEstimatedShares,
                minOutputShares
            );
        }
        return
            Math.mulDiv(
                currentEstimatedShares - minOutputShares,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                currentEstimatedShares
            );
    }

    /**
     * @dev Calculates and validates the required additional collateral amount
     */
    function calculateRequiredAdditionalCollateral(
        uint256 leveragedCollateralAmount,
        uint256 depositCollateralAmount
    ) internal pure returns (uint256) {
        if (leveragedCollateralAmount < depositCollateralAmount) {
            revert LeveragedCollateralAmountLessThanDepositCollateralAmount(
                leveragedCollateralAmount,
                depositCollateralAmount
            );
        }
        return leveragedCollateralAmount - depositCollateralAmount;
    }

    /**
     * @dev Encodes flash loan parameters to data
     */
    function encodeFlashLoanParams(
        address receiver,
        uint256 depositCollateralAmount,
        uint256 leveragedCollateralAmount,
        bytes memory debtTokenToCollateralSwapData,
        DLoopCoreBase dLoopCore
    ) internal pure returns (bytes memory data) {
        data = abi.encode(
            receiver,
            depositCollateralAmount,
            leveragedCollateralAmount,
            debtTokenToCollateralSwapData,
            dLoopCore
        );
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
            address receiver,
            uint256 depositCollateralAmount,
            uint256 leveragedCollateralAmount,
            bytes memory debtTokenToCollateralSwapData,
            DLoopCoreBase dLoopCore
        )
    {
        (
            receiver,
            depositCollateralAmount,
            leveragedCollateralAmount,
            debtTokenToCollateralSwapData,
            dLoopCore
        ) = abi.decode(data, (address, uint256, uint256, bytes, DLoopCoreBase));
    }
}
