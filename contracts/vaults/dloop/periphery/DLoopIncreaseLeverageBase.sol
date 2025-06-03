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

pragma solidity 0.8.20;

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
    // [dLoopCore][tokenAddress] -> leftOverAmount
    mapping(address => mapping(address => uint256))
        public minLeftoverDebtTokenAmount;
    // [tokenAddress] -> exists (for gas efficient token tracking)
    mapping(address => bool) private _existingDebtTokensMap;
    address[] public existingDebtTokens;

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
    error RequiredCollateralAmountExceedsUserBalance(
        uint256 requiredCollateralAmount,
        uint256 userCollateralBalance,
        uint256 additionalCollateralFromUser
    );
    error FlashLoanAmountExceedsMaxAvailable(
        uint256 requiredFlashLoanAmount,
        uint256 maxFlashLoanAmount
    );
    error LeverageNotIncreased(
        uint256 leverageBeforeIncrease,
        uint256 leverageAfterIncrease
    );
    error ReceivedDebtTokenNotMetMinReceiveAmount(
        uint256 receivedDebtTokenAmount,
        uint256 minOutputDebtTokenAmount
    );

    /* Events */

    event LeftoverDebtTokensTransferred(
        address indexed dLoopCore,
        address indexed debtToken,
        uint256 amount
    );
    event MinLeftoverDebtTokenAmountSet(
        address indexed dLoopCore,
        address indexed debtToken,
        uint256 minAmount
    );

    /* Structs */

    struct FlashLoanParams {
        address user;
        uint256 additionalCollateralFromUser;
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
        // Return the existing tokens as we handle leftover debt tokens
        return existingDebtTokens;
    }

    /* Increase Leverage */

    /**
     * @dev Increases leverage with flash loans
     *      - Flash loans debt tokens, swaps to collateral tokens, calls increaseLeverage, uses received debt tokens to repay flash loan
     * @param additionalCollateralFromUser Additional collateral token amount from user (can be 0)
     * @param minOutputDebtTokenAmount Minimum amount of debt token to receive (slippage protection)
     * @param debtTokenToCollateralSwapData Swap data from debt token to collateral token
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return receivedDebtTokenAmount Amount of debt tokens received from increase leverage operation
     */
    function increaseLeverage(
        uint256 additionalCollateralFromUser,
        uint256 minOutputDebtTokenAmount,
        bytes calldata debtTokenToCollateralSwapData,
        DLoopCoreBase dLoopCore
    ) public nonReentrant returns (uint256 receivedDebtTokenAmount) {
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        // Transfer any additional collateral token from user if provided
        if (additionalCollateralFromUser > 0) {
            collateralToken.safeTransferFrom(
                msg.sender,
                address(this),
                additionalCollateralFromUser
            );
        }

        // Calculate the required collateral amount to reach target leverage
        (uint256 requiredCollateralAmount, int8 direction) = dLoopCore
            .getAmountToReachTargetLeverage(true); // Use vault token balance

        // Verify we need to increase leverage
        if (direction != 1) {
            revert("Current leverage is already at or above target");
        }

        // Calculate how much we need from flash loan
        uint256 collateralFromUser = additionalCollateralFromUser +
            collateralToken.balanceOf(address(this));
        if (requiredCollateralAmount > collateralFromUser) {
            uint256 requiredCollateralFromFlashLoan = requiredCollateralAmount -
                collateralFromUser;

            // Convert collateral amount to debt token amount for flash loan
            uint256 requiredFlashLoanAmount = dLoopCore
                .convertFromTokenAmountToBaseCurrency(
                    requiredCollateralFromFlashLoan,
                    address(collateralToken)
                );
            requiredFlashLoanAmount = dLoopCore.convertFromBaseCurrencyToToken(
                requiredFlashLoanAmount,
                address(debtToken)
            );

            // Check if flash loan amount is available
            uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(
                address(debtToken)
            );
            if (requiredFlashLoanAmount > maxFlashLoanAmount) {
                revert FlashLoanAmountExceedsMaxAvailable(
                    requiredFlashLoanAmount,
                    maxFlashLoanAmount
                );
            }

            // Create flash loan params
            FlashLoanParams memory params = FlashLoanParams(
                msg.sender,
                additionalCollateralFromUser,
                requiredCollateralAmount,
                debtTokenToCollateralSwapData,
                dLoopCore
            );
            bytes memory data = _encodeParamsToData(params);

            // Record initial leverage
            uint256 leverageBeforeIncrease = dLoopCore.getCurrentLeverageBps();

            // This value is used to check if the debt token balance increased after increase leverage
            uint256 debtTokenBalanceBeforeIncrease = debtToken.balanceOf(
                address(this)
            );

            // Approve flash lender to spend debt tokens
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

            // Verify leverage increased
            uint256 leverageAfterIncrease = dLoopCore.getCurrentLeverageBps();
            if (leverageAfterIncrease <= leverageBeforeIncrease) {
                revert LeverageNotIncreased(
                    leverageBeforeIncrease,
                    leverageAfterIncrease
                );
            }

            // Calculate received debt tokens
            uint256 debtTokenBalanceAfterIncrease = debtToken.balanceOf(
                address(this)
            );
            if (
                debtTokenBalanceAfterIncrease <= debtTokenBalanceBeforeIncrease
            ) {
                revert DebtTokenBalanceNotIncreasedAfterIncreaseLeverage(
                    debtTokenBalanceBeforeIncrease,
                    debtTokenBalanceAfterIncrease
                );
            }

            receivedDebtTokenAmount =
                debtTokenBalanceAfterIncrease -
                debtTokenBalanceBeforeIncrease;
        } else {
            // No flash loan needed, direct increase leverage
            uint256 leverageBeforeIncrease = dLoopCore.getCurrentLeverageBps();
            uint256 debtTokenBalanceBeforeIncrease = debtToken.balanceOf(
                address(this)
            );

            // Approve collateral token for core contract
            collateralToken.forceApprove(
                address(dLoopCore),
                collateralFromUser
            );

            // Call increase leverage directly
            dLoopCore.increaseLeverage(
                additionalCollateralFromUser,
                minOutputDebtTokenAmount
            );

            // Verify leverage increased
            uint256 leverageAfterIncrease = dLoopCore.getCurrentLeverageBps();
            if (leverageAfterIncrease <= leverageBeforeIncrease) {
                revert LeverageNotIncreased(
                    leverageBeforeIncrease,
                    leverageAfterIncrease
                );
            }

            // Calculate received debt tokens
            uint256 debtTokenBalanceAfterIncrease = debtToken.balanceOf(
                address(this)
            );
            if (
                debtTokenBalanceAfterIncrease <= debtTokenBalanceBeforeIncrease
            ) {
                revert DebtTokenBalanceNotIncreasedAfterIncreaseLeverage(
                    debtTokenBalanceBeforeIncrease,
                    debtTokenBalanceAfterIncrease
                );
            }

            receivedDebtTokenAmount =
                debtTokenBalanceAfterIncrease -
                debtTokenBalanceBeforeIncrease;
        }

        // Slippage protection
        if (receivedDebtTokenAmount < minOutputDebtTokenAmount) {
            revert ReceivedDebtTokenNotMetMinReceiveAmount(
                receivedDebtTokenAmount,
                minOutputDebtTokenAmount
            );
        }

        // Handle any leftover debt tokens
        uint256 leftoverAmount = debtToken.balanceOf(address(this));
        if (
            leftoverAmount >
            minLeftoverDebtTokenAmount[address(dLoopCore)][address(debtToken)]
        ) {
            debtToken.safeTransfer(address(dLoopCore), leftoverAmount);
            emit LeftoverDebtTokensTransferred(
                address(dLoopCore),
                address(debtToken),
                leftoverAmount
            );
        }

        // Transfer received debt tokens to user
        debtToken.safeTransfer(msg.sender, receivedDebtTokenAmount);

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
    ) external override nonReentrant returns (bytes32) {
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

        // Swap flash loaned debt tokens to collateral tokens
        uint256 requiredCollateralFromFlashLoan = flashLoanParams
            .requiredCollateralAmount -
            flashLoanParams.additionalCollateralFromUser -
            collateralToken.balanceOf(address(this));

        uint256 debtTokenUsedInSwap = _swapExactOutput(
            debtToken,
            collateralToken,
            requiredCollateralFromFlashLoan,
            type(uint256).max, // No slippage protection here
            address(this),
            block.timestamp,
            flashLoanParams.debtTokenToCollateralSwapData
        );

        // Record debt token balance before increase leverage
        uint256 debtTokenBalanceBeforeIncrease = debtToken.balanceOf(
            address(this)
        );

        // Approve collateral for core contract
        collateralToken.forceApprove(
            address(dLoopCore),
            flashLoanParams.requiredCollateralAmount
        );

        // Call increase leverage on core contract
        dLoopCore.increaseLeverage(
            flashLoanParams.additionalCollateralFromUser,
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
        if (debtTokenReceived < debtTokenUsedInSwap + fee) {
            revert DebtTokenReceivedNotMetUsedAmountWithFlashLoanFee(
                debtTokenReceived,
                debtTokenUsedInSwap,
                fee
            );
        }

        return FLASHLOAN_CALLBACK;
    }

    /* Setters */

    /**
     * @dev Sets the minimum leftover debt token amount for a given dLoopCore and debt token
     * @param dLoopCore Address of the dLoopCore contract
     * @param debtToken Address of the debt token
     * @param minAmount Minimum leftover debt token amount for the given dLoopCore and debt token
     */
    function setMinLeftoverDebtTokenAmount(
        address dLoopCore,
        address debtToken,
        uint256 minAmount
    ) external nonReentrant onlyOwner {
        minLeftoverDebtTokenAmount[dLoopCore][debtToken] = minAmount;
        if (!_existingDebtTokensMap[debtToken]) {
            _existingDebtTokensMap[debtToken] = true;
            existingDebtTokens.push(debtToken);
        }
        emit MinLeftoverDebtTokenAmountSet(dLoopCore, debtToken, minAmount);
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
            _flashLoanParams.additionalCollateralFromUser,
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
            _flashLoanParams.additionalCollateralFromUser,
            _flashLoanParams.requiredCollateralAmount,
            _flashLoanParams.debtTokenToCollateralSwapData,
            _flashLoanParams.dLoopCore
        ) = abi.decode(data, (address, uint256, uint256, bytes, DLoopCoreBase));
    }
}
