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

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IERC3156FlashBorrower} from "./interface/flashloan/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "./interface/flashloan/IERC3156FlashLender.sol";
import {DLoopCoreBase} from "../core/DLoopCoreBase.sol";
import {SwappableVault} from "contracts/common/SwappableVault.sol";
import {RescuableVault} from "contracts/common/RescuableVault.sol";
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";

/**
 * @title DLoopIncreaseLeverageBase
 * @dev A helper contract for increasing leverage with flash loans
 *      - Suppose the core contract current leverage is 2x, target leverage is 3x, collateral token is WETH, debt token is dUSD
 *      - User wants to increase leverage to target (3x) but doesn't have enough collateral tokens
 *      - This contract will flashloan debt tokens, swap them to collateral tokens, call increaseLeverage on core,
 *        and use the received debt tokens to repay the flashloan
 *      - Example: Flash loan 50,000 dUSD -> swap to 25 WETH -> call increaseLeverage with 25 WETH -> receive 50,000+ dUSD -> repay flash loan
 */
abstract contract DLoopIncreaseLeverageBase is
    IERC3156FlashBorrower,
    Ownable,
    ReentrancyGuard,
    SwappableVault,
    RescuableVault
{
    using SafeERC20 for ERC20;

    /* Constants */

    bytes32 public constant FLASHLOAN_CALLBACK =
        keccak256("ERC3156FlashBorrower.onFlashLoan");

    /* Core state */

    IERC3156FlashLender public immutable flashLender;

    /* Errors */

    error UnknownLender(address msgSender, address flashLender);
    error UnknownInitiator(address initiator, address thisContract);
    error IncompatibleDLoopCoreDebtToken(
        address currentDebtToken,
        address dLoopCoreDebtToken
    );
    error DebtTokenBalanceNotIncreasedAfterIncreaseLeverage(
        uint256 debtTokenBalanceBeforeIncrease,
        uint256 debtTokenBalanceAfterIncrease
    );
    error DebtTokenReceivedNotMetUsedAmountWithFlashLoanFee(
        uint256 debtTokenReceived,
        uint256 debtTokenUsed,
        uint256 flashLoanFee
    );
    error FlashLoanAmountExceedsMaxAvailable(
        uint256 requiredFlashLoanAmount,
        uint256 maxFlashLoanAmount
    );
    error LeverageNotIncreased(
        uint256 leverageBeforeIncrease,
        uint256 leverageAfterIncrease
    );
    error RequiredFlashLoanCollateralAmountIsZero();
    error LeverageAlreadyAtOrAboveTarget(
        uint256 currentLeverage,
        uint256 targetLeverage
    );

    /* Events */

    event LeftoverDebtTokensTransferred(
        address indexed debtToken,
        uint256 amount,
        address indexed receiver
    );

    /* Structs */

    struct FlashLoanParams {
        address user;
        uint256 requiredCollateralAmount;
        bytes debtTokenToCollateralSwapData;
        DLoopCoreBase dLoopCore;
    }

    /**
     * @dev Constructor for the DLoopIncreaseLeverageBase contract
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
    function getRestrictedRescueTokens()
        public
        view
        virtual
        override
        returns (address[] memory restrictedTokens)
    {
        // Return empty array as we no longer handle leftover debt tokens
        return new address[](0);
    }

    /* Increase Leverage */

    /**
     * @dev Increases leverage with flash loans
     *      - Flash loans debt tokens, swaps to collateral tokens, calls increaseLeverage, uses received debt tokens to repay flash loan
     *      - There is no slippage protection as there is no risky of calling this function
     *        thus a revert due to minOutput may destroy the user's profit, even it is tiny (less than minOutput)
     *      - We let the caller to specify the amount of collateral token to rebalance as it is more flexible
     *        for the swap slippage, sometime if swapping a big amount of collateral token, the slippage may be too high
     *        and the transfer will fail.
     * @param rebalanceCollateralAmount The amount of collateral token to rebalance
     * @param debtTokenToCollateralSwapData Swap data from debt token to collateral token
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return receivedDebtTokenAmount Amount of debt tokens received from increase leverage operation
     */
    function increaseLeverage(
        uint256 rebalanceCollateralAmount,
        bytes calldata debtTokenToCollateralSwapData,
        DLoopCoreBase dLoopCore
    ) public nonReentrant returns (uint256 receivedDebtTokenAmount) {
        // Record initial leverage
        uint256 leverageBeforeIncrease = dLoopCore.getCurrentLeverageBps();

        ERC20 collateralToken = dLoopCore.collateralToken();

        uint256 currentCollateralTokenBalance = collateralToken.balanceOf(
            address(this)
        );
        if (rebalanceCollateralAmount > currentCollateralTokenBalance) {
            // The caller is expected to receive some debt token as subsidy
            _increaseLeverageWithFlashLoan(
                rebalanceCollateralAmount,
                debtTokenToCollateralSwapData,
                dLoopCore
            );
        } else {
            // This case is free money, no need to have flash loan
            // The caller will receive all the borrowed debt tokens
            _increaseLeverageWithoutFlashLoan(
                dLoopCore,
                currentCollateralTokenBalance
            );
        }

        // Verify leverage increased
        uint256 leverageAfterIncrease = dLoopCore.getCurrentLeverageBps();
        if (leverageAfterIncrease <= leverageBeforeIncrease) {
            revert LeverageNotIncreased(
                leverageBeforeIncrease,
                leverageAfterIncrease
            );
        }

        // Transfer any leftover debt tokens directly to the user
        //   + If it is the case without flash loan, the leftover amount will be
        //     value equals to the currentCollateralTokenBalance, but in debt token
        //     and plus the subsidy in debt token.
        //   + If it is the case with flash loan, the leftover amount will be
        //     subsidy in debt token, plus the positive slippage in debt token
        //     during swapping.
        ERC20 debtToken = dLoopCore.debtToken();
        receivedDebtTokenAmount = debtToken.balanceOf(address(this));
        if (receivedDebtTokenAmount > 0) {
            debtToken.safeTransfer(msg.sender, receivedDebtTokenAmount);
            emit LeftoverDebtTokensTransferred(
                address(debtToken),
                receivedDebtTokenAmount,
                msg.sender
            );
        }

        return receivedDebtTokenAmount;
    }

    /* Flash loan entrypoint */

    /**
     * @dev Callback function for flash loans
     * @param initiator Address that initiated the flash loan
     * @param token Address of the flash-borrowed token
     * @param fee Flash loan fee
     * @param data Additional data passed to the flash loan
     * @return bytes32 The flash loan callback success bytes
     */
    function onFlashLoan(
        address initiator,
        address token,
        uint256 /* amount */,
        uint256 fee,
        bytes calldata data
    ) external override returns (bytes32) {
        // This function does not need nonReentrant as the flash loan will be called by increaseLeverage() public
        // function, which is already protected by nonReentrant
        // Moreover, this function is only be able to be called by the address(this) (check the initiator condition)
        // thus even though the flash loan is public and not protected by nonReentrant, it is still safe
        if (msg.sender != address(flashLender))
            revert UnknownLender(msg.sender, address(flashLender));
        if (initiator != address(this))
            revert UnknownInitiator(initiator, address(this));

        // Decode flash loan params
        FlashLoanParams memory flashLoanParams = _decodeDataToParams(data);
        DLoopCoreBase dLoopCore = flashLoanParams.dLoopCore;
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        // Verify token compatibility
        if (token != address(debtToken))
            revert IncompatibleDLoopCoreDebtToken(token, address(debtToken));

        if (flashLoanParams.requiredCollateralAmount == 0) {
            revert RequiredFlashLoanCollateralAmountIsZero();
        }

        // Swap flash loaned debt tokens to collateral tokens

        uint256 debtTokenUsedInSwap = 0;
        debtTokenUsedInSwap = _swapExactOutput(
            debtToken,
            collateralToken,
            flashLoanParams.requiredCollateralAmount,
            type(uint256).max, // No slippage protection here
            address(this),
            block.timestamp,
            flashLoanParams.debtTokenToCollateralSwapData
        );

        // Approve the core contract to spend the collateral token
        collateralToken.forceApprove(
            address(dLoopCore),
            flashLoanParams.requiredCollateralAmount
        );

        // Record debt token balance before calling core increaseLeverage
        uint256 debtTokenBalanceBeforeIncrease = debtToken.balanceOf(
            address(this)
        );

        // Call increase leverage on core contract
        dLoopCore.increaseLeverage(
            flashLoanParams.requiredCollateralAmount,
            0 // No min amount check here, will be checked in main function
        );

        // Verify we received enough debt tokens to repay flash loan
        uint256 debtTokenBalanceAfterIncrease = debtToken.balanceOf(
            address(this)
        );
        if (debtTokenBalanceAfterIncrease <= debtTokenBalanceBeforeIncrease) {
            revert DebtTokenBalanceNotIncreasedAfterIncreaseLeverage(
                debtTokenBalanceBeforeIncrease,
                debtTokenBalanceAfterIncrease
            );
        }

        uint256 debtTokenReceived = debtTokenBalanceAfterIncrease -
            debtTokenBalanceBeforeIncrease;

        // Ensure we can repay flash loan
        // This is an early revert to avoid unclear revert message
        if (debtTokenReceived < debtTokenUsedInSwap + fee) {
            revert DebtTokenReceivedNotMetUsedAmountWithFlashLoanFee(
                debtTokenReceived,
                debtTokenUsedInSwap,
                fee
            );
        }

        return FLASHLOAN_CALLBACK;
    }

    /* Internal helpers */

    /**
     * @dev Executes increase leverage with flash loan
     * @param requiredCollateralAmount Required collateral amount
     * @param debtTokenToCollateralSwapData Swap data
     * @param dLoopCore DLoop core contract
     */
    function _increaseLeverageWithFlashLoan(
        uint256 requiredCollateralAmount,
        bytes calldata debtTokenToCollateralSwapData,
        DLoopCoreBase dLoopCore
    ) internal {
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        // Convert collateral amount to debt token amount for flash loan
        uint256 requiredFlashLoanAmountInBase = dLoopCore
            .convertFromTokenAmountToBaseCurrency(
                requiredCollateralAmount,
                address(collateralToken)
            );
        uint256 requiredFlashLoanAmount = dLoopCore
            .convertFromBaseCurrencyToToken(
                requiredFlashLoanAmountInBase,
                address(debtToken)
            );

        // Check if flash loan amount is available
        uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(
            address(debtToken)
        ) / 10; // Only flash loan 1/10 of the max amount to avoid overflow issue
        if (requiredFlashLoanAmount > maxFlashLoanAmount) {
            revert FlashLoanAmountExceedsMaxAvailable(
                requiredFlashLoanAmount,
                maxFlashLoanAmount
            );
        }

        // Create flash loan params
        FlashLoanParams memory params = FlashLoanParams(
            msg.sender,
            requiredCollateralAmount,
            debtTokenToCollateralSwapData,
            dLoopCore
        );
        bytes memory data = _encodeParamsToData(params);

        // Approve flash lender to spend debt tokens
        // to repay the flash loan
        debtToken.forceApprove(
            address(flashLender),
            requiredFlashLoanAmount +
                flashLender.flashFee(
                    address(debtToken),
                    requiredFlashLoanAmount
                )
        );

        // Execute flash loan - main logic in onFlashLoan
        flashLender.flashLoan(
            this,
            address(debtToken),
            requiredFlashLoanAmount,
            data
        );
    }

    /**
     * @dev Increases leverage without flash loan
     * @param dLoopCore DLoop core contract
     * @param currentCollateralTokenBalance current collateral token balance
     */
    function _increaseLeverageWithoutFlashLoan(
        DLoopCoreBase dLoopCore,
        uint256 currentCollateralTokenBalance
    ) internal {
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        // No flash loan needed, direct increase leverage
        uint256 debtTokenBalanceBeforeIncrease = debtToken.balanceOf(
            address(this)
        );

        // Approve collateral token for core contract
        collateralToken.forceApprove(
            address(dLoopCore),
            currentCollateralTokenBalance
        );

        // Call increase leverage directly
        dLoopCore.increaseLeverage(
            currentCollateralTokenBalance,
            0 // no need to have slippage protection here
        );

        // Calculate received debt tokens
        // As we supply collateral, thus must receive back some debt
        uint256 debtTokenBalanceAfterIncrease = debtToken.balanceOf(
            address(this)
        );
        if (debtTokenBalanceAfterIncrease <= debtTokenBalanceBeforeIncrease) {
            revert DebtTokenBalanceNotIncreasedAfterIncreaseLeverage(
                debtTokenBalanceBeforeIncrease,
                debtTokenBalanceAfterIncrease
            );
        }
    }

    /* Data encoding/decoding helpers */

    /**
     * @dev Encodes flash loan parameters to data
     * @param _flashLoanParams Flash loan parameters
     * @return data Encoded data
     */
    function _encodeParamsToData(
        FlashLoanParams memory _flashLoanParams
    ) internal pure returns (bytes memory data) {
        data = abi.encode(
            _flashLoanParams.user,
            _flashLoanParams.requiredCollateralAmount,
            _flashLoanParams.debtTokenToCollateralSwapData,
            _flashLoanParams.dLoopCore
        );
    }

    /**
     * @dev Decodes data to flash loan parameters
     * @param data Encoded data
     * @return _flashLoanParams Decoded flash loan parameters
     */
    function _decodeDataToParams(
        bytes memory data
    ) internal pure returns (FlashLoanParams memory _flashLoanParams) {
        (
            _flashLoanParams.user,
            _flashLoanParams.requiredCollateralAmount,
            _flashLoanParams.debtTokenToCollateralSwapData,
            _flashLoanParams.dLoopCore
        ) = abi.decode(data, (address, uint256, bytes, DLoopCoreBase));
    }
}
