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
 * @title DLoopDecreaseLeverageBase
 * @dev A helper contract for decreasing leverage with flash loans
 *      - Suppose the core contract current leverage is 4x, target leverage is 3x, collateral token is WETH, debt token is dUSD
 *      - User wants to decrease leverage to target (3x) but doesn't have enough debt tokens
 *      - This contract will flashloan debt tokens, call decreaseLeverage on core to get collateral tokens,
 *        swap the received collateral tokens to debt tokens, and use the debt tokens to repay the flashloan
 *      - Example: Flash loan 50,000 dUSD -> call decreaseLeverage with 50,000 dUSD -> receive 25+ WETH -> swap to 50,000+ dUSD -> repay flash loan
 */
abstract contract DLoopDecreaseLeverageBase is
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
    error CollateralTokenBalanceNotIncreasedAfterDecreaseLeverage(
        uint256 collateralTokenBalanceBeforeDecrease,
        uint256 collateralTokenBalanceAfterDecrease
    );
    error FlashLoanAmountExceedsMaxAvailable(
        uint256 requiredFlashLoanAmount,
        uint256 maxFlashLoanAmount
    );
    error LeverageNotDecreased(
        uint256 leverageBeforeDecrease,
        uint256 leverageAfterDecrease
    );
    error LeverageAlreadyAtOrBelowTarget(
        uint256 currentLeverage,
        uint256 targetLeverage
    );

    /* Events */

    event LeftoverCollateralTokensTransferred(
        address indexed collateralToken,
        uint256 amount,
        address indexed receiver
    );

    /* Structs */

    struct FlashLoanParams {
        uint256 requiredDebtAmount;
        bytes collateralToDebtTokenSwapData;
        DLoopCoreBase dLoopCore;
    }

    // Struct to group decrease leverage operation state to reduce stack depth
    struct DecreaseLeverageState {
        uint256 leverageBeforeDecrease;
        uint256 leverageAfterDecrease;
        uint256 collateralTokenBalanceBeforeDecrease;
        uint256 collateralTokenBalanceAfterDecrease;
        uint256 requiredFlashLoanAmount;
        uint256 debtFromUser;
        uint256 requiredDebtFromFlashLoan;
    }

    /**
     * @dev Constructor for the DLoopDecreaseLeverageBase contract
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
        // Return empty array as we no longer handle leftover collateral tokens
        return new address[](0);
    }

    /* Decrease Leverage */

    /**
     * @dev Decreases leverage with flash loans
     *      - Flash loans debt tokens, calls decreaseLeverage, swaps received collateral tokens to debt tokens, uses debt tokens to repay flash loan
     *      - We let the caller to specify the amount of debt token to rebalance as it is more flexible
     *        for the swap slippage, sometime if swapping a big amount of debt token, the slippage may be too high
     *        and the transfer will fail.
     * @param rebalanceDebtAmount The amount of debt token to rebalance
     * @param collateralToDebtTokenSwapData Swap data from collateral token to debt token
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return receivedCollateralTokenAmount Amount of collateral tokens received from decrease leverage operation
     */
    function decreaseLeverage(
        uint256 rebalanceDebtAmount,
        bytes calldata collateralToDebtTokenSwapData,
        DLoopCoreBase dLoopCore
    ) public nonReentrant returns (uint256 receivedCollateralTokenAmount) {
        // Record initial leverage
        uint256 leverageBeforeDecrease = dLoopCore.getCurrentLeverageBps();

        uint256 currentDebtTokenBalance = dLoopCore.debtToken().balanceOf(
            address(this)
        );
        if (rebalanceDebtAmount > currentDebtTokenBalance) {
            _decreaseLeverageWithFlashLoan(
                rebalanceDebtAmount,
                collateralToDebtTokenSwapData,
                dLoopCore
            );
        } else {
            // No flash loan needed, direct decrease leverage
            _decreaseLeverageWithoutFlashLoan(
                dLoopCore,
                currentDebtTokenBalance
            );
        }

        // Verify leverage decreased
        uint256 leverageAfterDecrease = dLoopCore.getCurrentLeverageBps();
        if (leverageAfterDecrease >= leverageBeforeDecrease) {
            revert LeverageNotDecreased(
                leverageBeforeDecrease,
                leverageAfterDecrease
            );
        }

        ERC20 collateralToken = dLoopCore.collateralToken();

        // Transfer received collateral tokens to user
        collateralToken.safeTransfer(msg.sender, receivedCollateralTokenAmount);

        // Transfer any leftover collateral tokens directly to the user
        uint256 leftoverAmount = collateralToken.balanceOf(address(this));
        if (leftoverAmount > 0) {
            collateralToken.safeTransfer(msg.sender, leftoverAmount);
            emit LeftoverCollateralTokensTransferred(
                address(collateralToken),
                leftoverAmount,
                msg.sender
            );
        }

        return receivedCollateralTokenAmount;
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
        uint256, // amount (flash loan amount)
        uint256 fee,
        bytes calldata data
    ) external override returns (bytes32) {
        // This function does not need nonReentrant as the flash loan will be called by decreaseLeverage() public
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

        // Record collateral token balance before decrease leverage
        uint256 collateralTokenBalanceBeforeDecrease = collateralToken
            .balanceOf(address(this));

        // Approve debt for core contract
        debtToken.forceApprove(
            address(dLoopCore),
            flashLoanParams.requiredDebtAmount
        );

        // Call decrease leverage on core contract
        dLoopCore.decreaseLeverage(
            flashLoanParams.requiredDebtAmount,
            0 // No min amount check here, will be checked in main function
        );

        // Verify we received collateral tokens
        uint256 collateralTokenBalanceAfterDecrease = collateralToken.balanceOf(
            address(this)
        );
        if (
            collateralTokenBalanceAfterDecrease <=
            collateralTokenBalanceBeforeDecrease
        ) {
            revert CollateralTokenBalanceNotIncreasedAfterDecreaseLeverage(
                collateralTokenBalanceBeforeDecrease,
                collateralTokenBalanceAfterDecrease
            );
        }

        // Swap collateral tokens to debt tokens to repay flash loan + flash loan fee
        uint256 amountOutToRepay = flashLoanParams.requiredDebtAmount + fee;
        if (amountOutToRepay > 0) {
            _swapExactOutput(
                collateralToken,
                debtToken,
                amountOutToRepay,
                type(uint256).max, // No slippage protection here
                address(this),
                block.timestamp,
                flashLoanParams.collateralToDebtTokenSwapData
            );
        }

        return FLASHLOAN_CALLBACK;
    }

    /**
     * @dev Decreases leverage with flash loan
     * @param requiredDebtAmount Required debt amount
     * @param collateralToDebtTokenSwapData Swap data from collateral token to debt token
     * @param dLoopCore DLoop core contract
     */
    function _decreaseLeverageWithFlashLoan(
        uint256 requiredDebtAmount,
        bytes calldata collateralToDebtTokenSwapData,
        DLoopCoreBase dLoopCore
    ) internal {
        ERC20 debtToken = dLoopCore.debtToken();
        // Check if flash loan amount is available
        uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(
            address(debtToken)
        ) / 10; // Only flash loan 1/10 of the max amount to avoid overflow issue
        if (requiredDebtAmount > maxFlashLoanAmount) {
            revert FlashLoanAmountExceedsMaxAvailable(
                requiredDebtAmount,
                maxFlashLoanAmount
            );
        }

        // Create flash loan params
        FlashLoanParams memory params = FlashLoanParams(
            requiredDebtAmount,
            collateralToDebtTokenSwapData,
            dLoopCore
        );
        bytes memory data = _encodeParamsToData(params);

        // Approve flash lender to spend debt tokens for repayment
        debtToken.forceApprove(
            address(flashLender),
            requiredDebtAmount +
                flashLender.flashFee(address(debtToken), requiredDebtAmount)
        );

        // Execute flash loan - main logic in onFlashLoan
        flashLender.flashLoan(
            this,
            address(debtToken),
            requiredDebtAmount,
            data
        );
    }

    /**
     * @dev Decreases leverage without flash loan
     * @param dLoopCore DLoop core contract
     * @param currentDebtTokenBalance current debt token balance
     */
    function _decreaseLeverageWithoutFlashLoan(
        DLoopCoreBase dLoopCore,
        uint256 currentDebtTokenBalance
    ) internal {
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        // No flash loan needed, direct decrease leverage
        uint256 collateralTokenBalanceBeforeDecrease = collateralToken
            .balanceOf(address(this));

        // Approve the core contract to spend the debt token
        debtToken.forceApprove(address(dLoopCore), currentDebtTokenBalance);

        // Call decrease leverage directly
        dLoopCore.decreaseLeverage(
            currentDebtTokenBalance,
            0 // no need to have slippage protection here
        );

        // Make sure the collateral token balance increased after decrease leverage
        uint256 collateralTokenBalanceAfterDecrease = collateralToken.balanceOf(
            address(this)
        );
        if (
            collateralTokenBalanceAfterDecrease <=
            collateralTokenBalanceBeforeDecrease
        ) {
            revert CollateralTokenBalanceNotIncreasedAfterDecreaseLeverage(
                collateralTokenBalanceBeforeDecrease,
                collateralTokenBalanceAfterDecrease
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
            _flashLoanParams.requiredDebtAmount,
            _flashLoanParams.collateralToDebtTokenSwapData,
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
            _flashLoanParams.requiredDebtAmount,
            _flashLoanParams.collateralToDebtTokenSwapData,
            _flashLoanParams.dLoopCore
        ) = abi.decode(data, (uint256, bytes, DLoopCoreBase));
    }
}
