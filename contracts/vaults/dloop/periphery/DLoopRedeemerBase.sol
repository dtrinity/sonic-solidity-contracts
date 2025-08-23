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

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IERC3156FlashBorrower } from "./interface/flashloan/IERC3156FlashBorrower.sol";
import { IERC3156FlashLender } from "./interface/flashloan/IERC3156FlashLender.sol";
import { DLoopCoreBase } from "../core/DLoopCoreBase.sol";
import { SwappableVault } from "contracts/common/SwappableVault.sol";
import { RescuableVault } from "contracts/common/RescuableVault.sol";
import { SharedLogic } from "./helper/SharedLogic.sol";

/**
 * @title DLoopRedeemerBase
 * @dev A helper contract for withdrawing assets from the core vault with flash loans
 *      - Suppose that the core contract has leverage of 3x, and the collateral token is WETH, debt token is dUSD, price of WETH is 1000, price of dUSD is 2000
 *      - ie, given user has 300 shares representing 300 WETH, and wants to withdraw 300 WETH, this contract will do a flash loan to get 200 * 2000 dUSD
 *        to repay the debt in the core vault, then withdraw 300 WETH from the core vault. The contract will swap 200 WETH to 200 * 2000 dUSD to repay the flash loan.
 *      - In the final state, the user has 100 WETH (300 - 200), and the core contract has 0 WETH as collateral, 0 dUSD as debt
 *      - NOTE: This contract only support redeem() from DLoopCore contracts, not withdraw()
 */
abstract contract DLoopRedeemerBase is IERC3156FlashBorrower, Ownable, ReentrancyGuard, SwappableVault, RescuableVault {
    using SafeERC20 for ERC20;

    /* Constants */

    bytes32 public constant FLASHLOAN_CALLBACK = keccak256("ERC3156FlashBorrower.onFlashLoan");

    /* Core state */

    IERC3156FlashLender public immutable flashLender;

    /* Errors */

    error UnknownLender(address msgSender, address flashLender);
    error UnknownInitiator(address initiator, address thisContract);
    error IncompatibleDLoopCoreDebtToken(address currentDebtToken, address dLoopCoreDebtToken);
    error SharesNotDecreasedAfterFlashLoan(uint256 sharesBeforeWithdraw, uint256 sharesAfterWithdraw);
    error InsufficientOutput(uint256 received, uint256 expected);
    error UnexpectedIncreaseInDebtToken(uint256 debtTokenBalanceBefore, uint256 debtTokenBalanceAfter);
    error UnexpectedDecreaseInCollateralToken(
        uint256 collateralTokenBalanceBefore,
        uint256 collateralTokenBalanceAfter
    );
    error UnexpectedDecreaseInCollateralTokenAfterFlashLoan(
        uint256 collateralTokenBalanceBefore,
        uint256 collateralTokenBalanceAfter
    );
    error IncorrectSharesBurned(uint256 expected, uint256 actual);
    error WithdrawnCollateralTokenAmountNotMetMinReceiveAmount(
        uint256 withdrawnCollateralTokenAmount,
        uint256 minReceiveCollateralTokenAmount
    );
    error EstimatedCollateralTokenAmountLessThanMinOutputCollateralAmount(
        uint256 currentCollateralTokenAmount,
        uint256 minOutputCollateralAmount
    );
    error FlashLenderNotSameAsDebtToken(address flashLender, address debtToken);
    error SlippageBpsCannotExceedOneHundredPercent(uint256 slippageBps);

    /* Events */

    event LeftoverCollateralTokensTransferred(
        address indexed collateralToken,
        uint256 amount,
        address indexed receiver
    );

    /* Structs */

    struct FlashLoanParams {
        uint256 shares;
        bytes collateralToDebtTokenSwapData;
        DLoopCoreBase dLoopCore;
    }

    /**
     * @dev Constructor for the DLoopRedeemerBase contract
     * @param _flashLender Address of the flash loan provider
     */
    constructor(IERC3156FlashLender _flashLender) Ownable(msg.sender) {
        flashLender = _flashLender;
    }

    /* RescuableVault Override */

    /**
     * @dev Gets the restricted rescue tokens
     * @return restrictedTokens Restricted rescue tokens
     */
    function getRestrictedRescueTokens() public view virtual override returns (address[] memory restrictedTokens) {
        // Return empty array as we no longer handle leftover collateral tokens
        return new address[](0);
    }

    /* Redeem */

    /**
     * @dev Calculates the minimum output collateral amount for a given shares and slippage bps
     * @param shares Amount of shares to redeem
     * @param slippageBps Slippage bps
     * @param dLoopCore Address of the DLoopCore contract
     * @return minOutputCollateralAmount Minimum output collateral amount
     */
    function calculateMinOutputCollateral(
        uint256 shares,
        uint256 slippageBps,
        DLoopCoreBase dLoopCore
    ) public view returns (uint256) {
        if (slippageBps > BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert SlippageBpsCannotExceedOneHundredPercent(slippageBps);
        }
        uint256 expectedLeverageCollateral = dLoopCore.previewRedeem(shares);
        uint256 unleveragedCollateral = getUnleveragedAssets(expectedLeverageCollateral, dLoopCore);
        return
            Math.mulDiv(
                unleveragedCollateral,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - slippageBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );
    }

    /**
     * @dev Gets the unleveraged assets for a given leveraged assets and dLoopCore
     * @param leveragedAssets Amount of leveraged assets
     * @param dLoopCore Address of the DLoopCore contract
     * @return unleveragedAssets Amount of unleveraged assets
     */
    function getUnleveragedAssets(uint256 leveragedAssets, DLoopCoreBase dLoopCore) public view returns (uint256) {
        return SharedLogic.getUnleveragedAssets(leveragedAssets, dLoopCore);
    }

    /**
     * @dev Redeems shares from the core vault with flash loans
     *      - The required debt token to withdraw will be flash loaned from the flash lender
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive the assets
     * @param minOutputCollateralAmount Minimum amount of collateral token to receive (slippage protection)
     * @param collateralToDebtTokenSwapData Swap data from collateral token to debt token
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return assets Amount of assets redeemed
     */
    function redeem(
        uint256 shares,
        address receiver,
        uint256 minOutputCollateralAmount,
        bytes calldata collateralToDebtTokenSwapData,
        DLoopCoreBase dLoopCore
    ) public nonReentrant returns (uint256 assets) {
        // Transfer the shares to the periphery contract to prepare for the redeeming process
        SafeERC20.safeTransferFrom(dLoopCore, msg.sender, address(this), shares);

        // Do not need to transfer the debt token to repay the lending pool, as it will be done with flash loan

        /**
         * In redeeming, we do not need to calculate the _calculateEstimatedOverallSlippageBps(), as the
         * withdrawn collateral token amount is always larger than the flashloan debt token amount (due to the leverage logic):
         *
         * According to the formula in getRepayAmountThatKeepCurrentLeverage() of DLoopCoreLogic:
         *       y = x * (T-1)/T
         *   and
         *       y = x * (T' - ONE_HUNDRED_PERCENT_BPS) / T'
         *   and
         *       T = T' / ONE_HUNDRED_PERCENT_BPS
         * where:
         *      - x is the collateral token amount
         *      - y is the debt token amount
         *      - T is the target leverage
         *      - T' is the target leverage in basis points unit
         *
         * We want find what is the condition of m so that we can withdraw the collateral token and swap
         * to the debt token which is sufficient to repay the flash loan amount and meet user minimum receiving
         * collateral amount. We want:
         *      y <= x * (1-s) - m
         * where:
         *      - m is the minimum receiving collateral amount in base currency
         *      - s is the swap slippage (0.01 means 1%)
         *
         * We have:
         *      y <= x * (1-s) - m
         *  <=> x * (T-1)/T <= x * (1-s) - m
         *  <=> x * (1-s) - x * (T-1)/T >= m
         *  <=> x * (1 - s - (T-1)/T) >= m
         *  <=> m <= x * (1 - s - (T-1)/T)
         *
         * Thus, the only thing to make the transaction works is to adjust the minOutputCollateralAmount
         * to be larger than the flashloan debt token amount, which is the leveraged amount
         */

        // Create the flash loan params data
        FlashLoanParams memory params = FlashLoanParams(shares, collateralToDebtTokenSwapData, dLoopCore);
        bytes memory data = _encodeParamsToData(params);
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();
        uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(address(debtToken));

        // This value is used to calculate the shares burned after the flash loan
        uint256 sharesBeforeRedeem = dLoopCore.balanceOf(address(this));

        // This value is used to calculate the received collateral token amount after the flash loan
        uint256 collateralTokenBalanceBefore = collateralToken.balanceOf(address(this));

        // Approve the flash lender to spend the flash loan amount of debt token from this contract
        debtToken.forceApprove(
            address(flashLender),
            maxFlashLoanAmount + flashLender.flashFee(address(debtToken), maxFlashLoanAmount)
        );

        // Make sure the flashLender is the same as the debt token
        if (address(flashLender) != address(debtToken)) {
            revert FlashLenderNotSameAsDebtToken(address(flashLender), address(debtToken));
        }

        // The main logic will be done in the onFlashLoan function
        flashLender.flashLoan(this, address(debtToken), maxFlashLoanAmount, data);

        // Validate shares burned correctly
        _validateSharesBurned(dLoopCore, address(this), shares, sharesBeforeRedeem);

        // Finalize redeem and transfer assets to receiver
        return
            _finalizeRedeemAndTransfer(
                collateralToken,
                receiver,
                collateralTokenBalanceBefore,
                minOutputCollateralAmount
            );
    }

    /* Flash loan entrypoint */

    /**
     * @dev Callback function for flash loans
     * @param initiator Address that initiated the flash loan
     * @param token Address of the flash-borrowed token
     * @param data Encoded flash loan parameters
     * @return bytes32 The flash loan callback success bytes
     */
    function onFlashLoan(
        address initiator,
        address token,
        uint256, // amount (flash loan amount)
        uint256 flashLoanFee, // fee (flash loan fee)
        bytes calldata data
    ) external override returns (bytes32) {
        // This function does not need nonReentrant as the flash loan will be called by redeem() public
        // function, which is already protected by nonReentrant
        // Moreover, this function is only be able to be called by the address(this) (check the initiator condition)
        // thus even though the flash loan is public and not protected by nonReentrant, it is still safe
        if (msg.sender != address(flashLender)) revert UnknownLender(msg.sender, address(flashLender));
        if (initiator != address(this)) revert UnknownInitiator(initiator, address(this));

        // Decode the flash loan params data
        FlashLoanParams memory flashLoanParams = _decodeDataToParams(data);
        DLoopCoreBase dLoopCore = flashLoanParams.dLoopCore;
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        // Make sure the input dLoopCore is compatible with this periphery contract
        if (token != address(debtToken)) revert IncompatibleDLoopCoreDebtToken(token, address(debtToken));

        // This value is used to calculate the debt token was used from the flash loan
        uint256 debtTokenBalanceBefore = debtToken.balanceOf(address(this));

        /**
         * Redeem the shares to get the collateral token
         * The core vault will also take the debt token from the periphery contract
         * to repay the debt and then withdraw the collateral token
         *
         * The receiver is this periphery contract as it needs to use the collateral token
         * to swap to the debt token to repay the flash loan
         *
         * The owner is the owner of the shares as it needs to burn the shares
         */
        debtToken.forceApprove(
            address(dLoopCore),
            type(uint256).max // No slippage tolerance
        );
        dLoopCore.redeem(
            flashLoanParams.shares,
            address(this), // receiver
            // the owner is the periphery contract as the shares were transferred from the owner to the periphery contract
            address(this) // owner
        );
        // Approve back to 0 to avoid any potential exploits later
        debtToken.forceApprove(address(dLoopCore), 0);

        // Calculate the debt token was used from the flash loan
        uint256 debtTokenBalanceAfter = debtToken.balanceOf(address(this));
        if (debtTokenBalanceAfter > debtTokenBalanceBefore) {
            revert UnexpectedIncreaseInDebtToken(debtTokenBalanceBefore, debtTokenBalanceAfter);
        }
        uint256 debtTokenUsed = debtTokenBalanceBefore - debtTokenBalanceAfter;

        /**
         * Swap the collateral token to the debt token to repay the flash loan
         *
         * Slippage protection is not needed here as the received collateral token
         * will be protected by the minOutputCollateralAmount of the redeem() function
         * - It means, if the swap has too high slippage, the final output collateral token
         *   amount will be less than the minOutputCollateralAmount, which will be reverted
         *   by the redeem() function
         */
        _swapExactOutput(
            collateralToken,
            debtToken,
            debtTokenUsed + flashLoanFee,
            type(uint256).max, // No slippage tolerance
            address(this),
            block.timestamp,
            flashLoanParams.collateralToDebtTokenSwapData
        );

        // If the swapped debt token amount is less than the debt token used,
        // the flash loan fee will be reverted

        // Return the success bytes
        return FLASHLOAN_CALLBACK;
    }

    /* Setters */

    /* Internal helpers */

    /**
     * @dev Validates that shares were burned correctly
     * @param dLoopCore The dLoopCore contract
     * @param owner The owner of the shares
     * @param shares Expected shares to be burned
     * @param sharesBeforeRedeem Shares balance before redeem
     */
    function _validateSharesBurned(
        DLoopCoreBase dLoopCore,
        address owner,
        uint256 shares,
        uint256 sharesBeforeRedeem
    ) internal view {
        // Check if the shares decreased after the flash loan
        uint256 sharesAfterRedeem = dLoopCore.balanceOf(owner);
        if (sharesAfterRedeem >= sharesBeforeRedeem) {
            revert SharesNotDecreasedAfterFlashLoan(sharesBeforeRedeem, sharesAfterRedeem);
        }

        // Make sure the burned shares is exactly the shares amount
        uint256 actualBurnedShares = sharesBeforeRedeem - sharesAfterRedeem;
        if (actualBurnedShares != shares) {
            revert IncorrectSharesBurned(shares, actualBurnedShares);
        }
    }

    /**
     * @dev Finalizes redeem by validating shares and transferring assets to receiver
     * @param collateralToken The collateral token
     * @param receiver Address to receive the assets
     * @param collateralTokenBalanceBefore Collateral balance before redeem
     * @param minOutputCollateralAmount Minimum output collateral amount
     * @return receivedCollateralTokenAmount Amount of collateral tokens received
     */
    function _finalizeRedeemAndTransfer(
        ERC20 collateralToken,
        address receiver,
        uint256 collateralTokenBalanceBefore,
        uint256 minOutputCollateralAmount
    ) internal returns (uint256 receivedCollateralTokenAmount) {
        // Collateral balance after the flash loan
        uint256 collateralTokenBalanceAfter = collateralToken.balanceOf(address(this));

        // Calculate the received collateral token amount after the flash loan
        if (collateralTokenBalanceAfter <= collateralTokenBalanceBefore) {
            revert UnexpectedDecreaseInCollateralTokenAfterFlashLoan(
                collateralTokenBalanceBefore,
                collateralTokenBalanceAfter
            );
        }

        // Make sure the received collateral token amount is not less than the minimum output collateral amount
        // for slippage protection
        receivedCollateralTokenAmount = collateralTokenBalanceAfter - collateralTokenBalanceBefore;
        if (receivedCollateralTokenAmount < minOutputCollateralAmount) {
            revert WithdrawnCollateralTokenAmountNotMetMinReceiveAmount(
                receivedCollateralTokenAmount,
                minOutputCollateralAmount
            );
        }

        // There is no leftover debt token, as all flash loaned debt token is used to repay the debt
        // when calling the redeem() function

        // Transfer the received collateral token to the receiver first
        collateralToken.safeTransfer(receiver, receivedCollateralTokenAmount);

        // Transfer any leftover collateral tokens directly to the receiver
        uint256 leftoverAmount = collateralToken.balanceOf(address(this));
        if (leftoverAmount > 0) {
            collateralToken.safeTransfer(receiver, leftoverAmount);
            emit LeftoverCollateralTokensTransferred(address(collateralToken), leftoverAmount, receiver);
        }
    }

    /* Data encoding/decoding helpers */

    /**
     * @dev Encodes flash loan parameters to data
     * @param _flashLoanParams Flash loan parameters
     * @return data Encoded data
     */
    function _encodeParamsToData(FlashLoanParams memory _flashLoanParams) internal pure returns (bytes memory data) {
        data = abi.encode(
            _flashLoanParams.shares,
            _flashLoanParams.collateralToDebtTokenSwapData,
            _flashLoanParams.dLoopCore
        );
    }

    /**
     * @dev Decodes data to flash loan withdraw parameters
     * @param data Encoded data
     * @return _flashLoanParams Decoded flash loan parameters
     */
    function _decodeDataToParams(bytes memory data) internal pure returns (FlashLoanParams memory _flashLoanParams) {
        (_flashLoanParams.shares, _flashLoanParams.collateralToDebtTokenSwapData, _flashLoanParams.dLoopCore) = abi
            .decode(data, (uint256, bytes, DLoopCoreBase));
    }
}
