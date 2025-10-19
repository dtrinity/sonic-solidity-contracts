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

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IERC3156FlashBorrower } from "./interface/flashloan/IERC3156FlashBorrower.sol";
import { IERC3156FlashLender } from "./interface/flashloan/IERC3156FlashLender.sol";
import { DLoopCoreBase } from "../core/DLoopCoreBase.sol";
import { SwappableVault } from "contracts/common/SwappableVault.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SharedLogic } from "./helper/SharedLogic.sol";
import { Compare } from "contracts/common/Compare.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title DLoopDepositorBase
 * @dev A helper contract for depositing leveraged assets into the core vault with flash loans
 *      - Suppose that the core contract has leverage of 3x, and the collateral token is WETH, debt token is dUSD, price of WETH is 1000, price of dUSD is 2000
 *      - ie, given user has 100 WETH, and wants to deposit 300 WETH, this contract will do a flash loan to get 200 * 2000 dUSD, then swap to get 200 WETH
 *        and then deposit totally 200+100=300 WETH into the core vault, then user receive 300 shares. The contract uses the received 200 * 2000 dUSD
 *        to repay the flash loan.
 *      - In the final state, the user has 300 shares representing 300 WETH, and the core contract has 300 WETH as collateral, 200 dUSD as debt
 *      - NOTE: This contract only support deposit() to DLoopCore contracts, not mint()
 */
abstract contract DLoopDepositorBase is
    IERC3156FlashBorrower,
    AccessControl,
    ReentrancyGuard,
    SwappableVault,
    Pausable
{
    using SafeERC20 for ERC20;

    /* Constants */

    bytes32 public constant DLOOP_ADMIN_ROLE = keccak256("DLOOP_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant FLASHLOAN_CALLBACK = keccak256("ERC3156FlashBorrower.onFlashLoan");

    /* Core state */

    IERC3156FlashLender public immutable flashLender;

    /* Errors */

    error UnknownLender(address msgSender, address flashLender);
    error UnknownInitiator(address initiator, address thisContract);
    error IncompatibleDLoopCoreDebtToken(address currentDebtToken, address dLoopCoreDebtToken);
    error SharesNotIncreasedAfterFlashLoan(uint256 sharesBeforeDeposit, uint256 sharesAfterDeposit);
    error DebtTokenBalanceNotIncreasedAfterDeposit(
        uint256 debtTokenBalanceBeforeDeposit,
        uint256 debtTokenBalanceAfterDeposit
    );
    error ReceivedSharesNotMetMinReceiveAmount(uint256 receivedShares, uint256 minOutputShares);
    error DebtTokenReceivedNotMetUsedAmountWithFlashLoanFee(
        uint256 debtTokenReceived,
        uint256 debtTokenUsed,
        uint256 flashLoanFee
    );
    error LeveragedCollateralAmountLessThanDepositCollateralAmount(
        uint256 leveragedCollateralAmount,
        uint256 depositCollateralAmount
    );
    error FlashLenderNotSameAsDebtToken(address flashLender, address debtToken);
    error SlippageBpsCannotExceedOneHundredPercent(uint256 slippageBps);

    /* Events */

    event LeftoverDebtTokensTransferred(address indexed debtToken, uint256 amount, address indexed receiver);

    event LeftoverCollateralTokensTransferred(
        address indexed collateralToken,
        uint256 amount,
        address indexed receiver
    );

    /* Structs */

    struct FlashLoanParams {
        address receiver;
        uint256 depositCollateralAmount;
        uint256 leveragedCollateralAmount;
        bytes debtTokenToCollateralSwapData;
        DLoopCoreBase dLoopCore;
    }

    /**
     * @dev Constructor for the DLoopDepositorBase contract
     * @param _flashLender Address of the flash loan provider
     */
    constructor(IERC3156FlashLender _flashLender) {
        flashLender = _flashLender;
        _setRoleAdmin(DLOOP_ADMIN_ROLE, DLOOP_ADMIN_ROLE);
        _setRoleAdmin(PAUSER_ROLE, DLOOP_ADMIN_ROLE);
        _grantRole(DLOOP_ADMIN_ROLE, _msgSender());
        _grantRole(PAUSER_ROLE, _msgSender());
    }

    /** Pausable Functions */

    /**
     * @dev Pauses the contract (exposes the internal pause function of Pausable)
     */
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses the contract (exposes the internal unpause function of Pausable)
     */
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /* Deposit */

    /**
     * @dev Calculates the minimum output shares for a given deposit amount and slippage bps
     * @param depositAmount Amount of collateral token to deposit
     * @param slippageBps Slippage bps
     * @param dLoopCore Address of the DLoopCore contract
     * @return minOutputShares Minimum output shares
     */
    function calculateMinOutputShares(
        uint256 depositAmount,
        uint256 slippageBps,
        DLoopCoreBase dLoopCore
    ) public view returns (uint256) {
        if (slippageBps > BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert SlippageBpsCannotExceedOneHundredPercent(slippageBps);
        }
        uint256 expectedLeveragedAssets = SharedLogic.getLeveragedAssets(depositAmount, dLoopCore);
        uint256 expectedShares = dLoopCore.convertToShares(expectedLeveragedAssets);
        return
            Math.mulDiv(
                expectedShares,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - slippageBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );
    }

    /**
     * @dev Deposits assets into the core vault with flash loans
     *      - The required collateral token to reeach the leveraged amount will be flash loaned from the flash lender
     * @param assets Amount of assets to deposit
     * @param receiver Address to receive the minted shares
     * @param minOutputShares Minimum amount of shares to receive (slippage protection)
     * @param debtTokenToCollateralSwapData Swap data from debt token to collateral token
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return shares Amount of shares minted
     */
    function deposit(
        uint256 assets, // deposit amount
        address receiver,
        uint256 minOutputShares,
        bytes calldata debtTokenToCollateralSwapData,
        DLoopCoreBase dLoopCore
    ) public nonReentrant whenNotPaused returns (uint256 shares) {
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        SharedLogic.TokenBalancesBeforeAfter memory collateralTokenBalancesBeforeAfter;
        SharedLogic.TokenBalancesBeforeAfter memory debtTokenBalancesBeforeAfter;

        // Track the token balances before the deposit
        collateralTokenBalancesBeforeAfter.token = collateralToken;
        collateralTokenBalancesBeforeAfter.tokenBalanceBefore = collateralToken.balanceOf(address(this));
        debtTokenBalancesBeforeAfter.token = debtToken;
        debtTokenBalancesBeforeAfter.tokenBalanceBefore = debtToken.balanceOf(address(this));

        // Transfer the collateral token to the vault (need the allowance before calling this function)
        // The remaining amount of collateral token will be flash loaned from the flash lender
        // to reach the leveraged amount
        collateralToken.safeTransferFrom(msg.sender, address(this), assets);

        uint256 leveragedCollateralAmount = SharedLogic.getLeveragedCollateralAmountWithSlippage(
            assets,
            minOutputShares,
            dLoopCore
        );

        // Create the flash loan params data
        FlashLoanParams memory params = FlashLoanParams(
            receiver,
            assets,
            leveragedCollateralAmount,
            debtTokenToCollateralSwapData,
            dLoopCore
        );
        bytes memory data = _encodeParamsToData(params);
        uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(address(debtToken));

        // This value is used to check if the shares increased after the flash loan
        uint256 sharesBeforeDeposit = dLoopCore.balanceOf(address(this));

        // Approve the flash lender to spend the flash loan amount of debt token from this contract
        ERC20(debtToken).forceApprove(
            address(flashLender),
            maxFlashLoanAmount + flashLender.flashFee(address(debtToken), maxFlashLoanAmount)
        );

        // Make sure the flashLender is the same as the debt token
        if (address(flashLender) != address(debtToken)) {
            revert FlashLenderNotSameAsDebtToken(address(flashLender), address(debtToken));
        }

        // The main logic will be done in the onFlashLoan function
        flashLender.flashLoan(this, address(debtToken), maxFlashLoanAmount, data);

        // The received debt token after deposit was used to repay the flash loan

        // Check if the shares increased after the flash loan
        uint256 sharesAfterDeposit = dLoopCore.balanceOf(address(this));
        if (sharesAfterDeposit <= sharesBeforeDeposit) {
            revert SharesNotIncreasedAfterFlashLoan(sharesBeforeDeposit, sharesAfterDeposit);
        }

        // Update the token balances before and after the deposit
        collateralTokenBalancesBeforeAfter.tokenBalanceAfter = collateralToken.balanceOf(address(this));
        debtTokenBalancesBeforeAfter.tokenBalanceAfter = debtToken.balanceOf(address(this));

        // Finalize deposit and transfer shares
        return
            _finalizeDepositAndTransfer(
                dLoopCore,
                collateralTokenBalancesBeforeAfter,
                debtTokenBalancesBeforeAfter,
                receiver,
                sharesBeforeDeposit,
                sharesAfterDeposit,
                minOutputShares
            );
    }

    /* Flash loan entrypoint */

    /**
     * @notice Callback function for flash loans
     * @dev Handles the flash loan execution for leveraged deposits. Only callable by the flash lender.
     * @param initiator Address that initiated the flash loan
     * @param token Address of the flash-borrowed token
     * @param flashLoanFee Flash loan fee amount
     * @param data Additional data passed to the flash loan
     * @return bytes32 The flash loan callback success bytes
     */
    function onFlashLoan(
        address initiator,
        address token,
        uint256, // amount (flash loan amount)
        uint256 flashLoanFee, // fee (flash loan fee)
        bytes calldata data
    ) external override whenNotPaused returns (bytes32) {
        // This function does not need nonReentrant as the flash loan will be called by deposit() public
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

        // Calculate and validate the required additional collateral amount
        uint256 requiredAdditionalCollateralAmount = _calculateRequiredAdditionalCollateral(flashLoanParams);

        /**
         * Swap the flash loan debt token to the collateral token
         *
         * Slippage protection is not needed here as the debt token to be used
         * is from flash loan, which is required to repay the flash loan later
         * Otherwise, the flash loan will be reverted
         */
        uint256 debtTokenAmountUsedInSwap = _swapExactOutput(
            debtToken,
            collateralToken,
            requiredAdditionalCollateralAmount, // exact output amount
            type(uint256).max, // no slippage protection
            address(this),
            block.timestamp,
            flashLoanParams.debtTokenToCollateralSwapData
        );

        // Execute deposit and validate debt token received
        _executeDepositAndValidate(
            flashLoanParams,
            collateralToken,
            debtToken,
            debtTokenAmountUsedInSwap,
            flashLoanFee
        );

        // Return the success bytes
        return FLASHLOAN_CALLBACK;
    }

    /* Setters */

    /* Internal helpers */

    /**
     * @dev Calculates and validates the required additional collateral amount
     * @param flashLoanParams Flash loan parameters
     * @return requiredAdditionalCollateralAmount The required additional collateral amount
     */
    function _calculateRequiredAdditionalCollateral(
        FlashLoanParams memory flashLoanParams
    ) internal pure returns (uint256 requiredAdditionalCollateralAmount) {
        // Calculate the required additional collateral amount to reach the leveraged amount
        // and make sure the overall slippage is included, which is to make sure the output
        // shares can be at least the min output shares (proven with formula)
        if (flashLoanParams.leveragedCollateralAmount < flashLoanParams.depositCollateralAmount) {
            revert LeveragedCollateralAmountLessThanDepositCollateralAmount(
                flashLoanParams.leveragedCollateralAmount,
                flashLoanParams.depositCollateralAmount
            );
        }
        requiredAdditionalCollateralAmount = (flashLoanParams.leveragedCollateralAmount -
            flashLoanParams.depositCollateralAmount);
    }

    /**
     * @dev Executes deposit to dLoop core and validates debt token received
     * @param flashLoanParams Flash loan parameters
     * @param collateralToken The collateral token
     * @param debtToken The debt token
     * @param debtTokenAmountUsedInSwap Amount of debt token used in swap
     * @param flashLoanFee Flash loan fee
     */
    function _executeDepositAndValidate(
        FlashLoanParams memory flashLoanParams,
        ERC20 collateralToken,
        ERC20 debtToken,
        uint256 debtTokenAmountUsedInSwap,
        uint256 flashLoanFee
    ) internal {
        // This value is used to check if the debt token balance increased after the deposit
        uint256 debtTokenBalanceBeforeDeposit = debtToken.balanceOf(address(this));

        /**
         * Deposit the collateral token to the core vault
         *
         * The receiver is this periphery contract as the core contract will send both debt token and
         * the minted shares to the receiver. This contract needs the debt token to repay the flash loan.
         *
         * The minted shares will be sent to the receiver later (outside of the flash loan callback)
         */
        collateralToken.forceApprove(address(flashLoanParams.dLoopCore), flashLoanParams.leveragedCollateralAmount);
        flashLoanParams.dLoopCore.deposit(flashLoanParams.leveragedCollateralAmount, address(this));

        // Debt token balance after deposit, which is used to sanity check the debt token balance increased after the deposit
        uint256 debtTokenBalanceAfterDeposit = debtToken.balanceOf(address(this));

        // Make sure to receive the debt token from the core vault to repay the flash loan
        if (debtTokenBalanceAfterDeposit <= debtTokenBalanceBeforeDeposit) {
            revert DebtTokenBalanceNotIncreasedAfterDeposit(
                debtTokenBalanceBeforeDeposit,
                debtTokenBalanceAfterDeposit
            );
        }

        // Calculate the debt token received after the deposit
        uint256 debtTokenReceivedAfterDeposit = debtTokenBalanceAfterDeposit - debtTokenBalanceBeforeDeposit;

        // Make sure the debt token received after the deposit is not less than the debt token used in the swap
        // to allow repaying the flash loan
        if (debtTokenReceivedAfterDeposit < debtTokenAmountUsedInSwap + flashLoanFee) {
            revert DebtTokenReceivedNotMetUsedAmountWithFlashLoanFee(
                debtTokenReceivedAfterDeposit,
                debtTokenAmountUsedInSwap,
                flashLoanFee
            );
        }
    }

    /**
     * @dev Finalizes deposit by validating shares and transferring to receiver
     * @param dLoopCore The dLoopCore contract
     * @param collateralTokenBalancesBeforeAfter Collateral token balances before and after the deposit
     * @param debtTokenBalancesBeforeAfter Debt token balances before and after the deposit
     * @param receiver Address to receive the shares
     * @param sharesBeforeDeposit Shares before deposit
     * @param sharesAfterDeposit Shares after deposit
     * @param minOutputShares Minimum output shares for slippage protection
     * @return shares Amount of shares minted
     */
    function _finalizeDepositAndTransfer(
        DLoopCoreBase dLoopCore,
        SharedLogic.TokenBalancesBeforeAfter memory collateralTokenBalancesBeforeAfter,
        SharedLogic.TokenBalancesBeforeAfter memory debtTokenBalancesBeforeAfter,
        address receiver,
        uint256 sharesBeforeDeposit,
        uint256 sharesAfterDeposit,
        uint256 minOutputShares
    ) internal returns (uint256 shares) {
        // Transfer any leftover debt tokens directly to the receiver
        {
            (uint256 leftoverDebtTokenAmount, bool success) = SharedLogic.transferLeftoverTokens(
                debtTokenBalancesBeforeAfter,
                receiver
            );
            if (success) {
                emit LeftoverDebtTokensTransferred(
                    address(debtTokenBalancesBeforeAfter.token),
                    leftoverDebtTokenAmount,
                    receiver
                );
            }
        }

        // Transfer any leftover collateral tokens directly to the receiver
        {
            (uint256 leftoverCollateralTokenAmount, bool success) = SharedLogic.transferLeftoverTokens(
                collateralTokenBalancesBeforeAfter,
                receiver
            );
            if (success) {
                emit LeftoverCollateralTokensTransferred(
                    address(collateralTokenBalancesBeforeAfter.token),
                    leftoverCollateralTokenAmount,
                    receiver
                );
            }
        }

        /**
         * Make sure the shares minted is not less than the minimum output shares
         * for slippage protection
         *
         * We only perform slippage protection outside of the flash loan callback
         * as we only need to care about the last state after the flash loan
         */
        shares = sharesAfterDeposit - sharesBeforeDeposit;
        if (shares < minOutputShares) {
            revert ReceivedSharesNotMetMinReceiveAmount(shares, minOutputShares);
        }

        // Transfer the minted shares to the receiver
        SafeERC20.safeTransfer(dLoopCore, receiver, shares);
    }

    /* Data encoding/decoding helpers */

    /**
     * @dev Encodes flash loan parameters to data
     * @param _flashLoanParams Flash loan parameters
     * @return data Encoded data
     */
    function _encodeParamsToData(FlashLoanParams memory _flashLoanParams) internal pure returns (bytes memory data) {
        data = abi.encode(
            _flashLoanParams.receiver,
            _flashLoanParams.depositCollateralAmount,
            _flashLoanParams.leveragedCollateralAmount,
            _flashLoanParams.debtTokenToCollateralSwapData,
            _flashLoanParams.dLoopCore
        );
    }

    /**
     * @dev Decodes data to flash loan deposit parameters
     * @param data Encoded data
     * @return _flashLoanParams Decoded flash loan parameters
     */
    function _decodeDataToParams(bytes memory data) internal pure returns (FlashLoanParams memory _flashLoanParams) {
        (
            _flashLoanParams.receiver,
            _flashLoanParams.depositCollateralAmount,
            _flashLoanParams.leveragedCollateralAmount,
            _flashLoanParams.debtTokenToCollateralSwapData,
            _flashLoanParams.dLoopCore
        ) = abi.decode(data, (address, uint256, uint256, bytes, DLoopCoreBase));
    }
}
