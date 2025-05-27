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

import {IERC3156FlashBorrower} from "./interface/flashloan/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "./interface/flashloan/IERC3156FlashLender.sol";
import {DLoopCoreBase} from "../core/DLoopCoreBase.sol";
import {SwappableVault} from "../libraries/SwappableVault.sol";
import {RescuableVault} from "../libraries/RescuableVault.sol";

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
    Ownable,
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
    error SharesNotIncreasedAfterFlashLoan(
        uint256 sharesBeforeDeposit,
        uint256 sharesAfterDeposit
    );
    error DebtTokenBalanceNotIncreasedAfterDeposit(
        uint256 debtTokenBalanceBeforeDeposit,
        uint256 debtTokenBalanceAfterDeposit
    );
    error ReceivedSharesNotMetMinReceiveAmount(
        uint256 receivedShares,
        uint256 minOutputShares
    );
    error DebtTokenReceivedNotMetUsedAmount(
        uint256 debtTokenReceived,
        uint256 debtTokenUsed
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
    constructor(IERC3156FlashLender _flashLender) Ownable(msg.sender) {
        flashLender = _flashLender;
    }

    /* Deposit */

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
        bytes memory debtTokenToCollateralSwapData,
        DLoopCoreBase dLoopCore
    ) public returns (uint256 shares) {
        // Transfer the collateral token to the vault (need the allowance before calling this function)
        // The remaining amount of collateral token will be flash loaned from the flash lender
        // to reach the leveraged amount
        ERC20 collateralToken = dLoopCore.collateralToken();
        collateralToken.safeTransferFrom(msg.sender, address(this), assets);

        // Create the flash loan params data
        FlashLoanParams memory params = FlashLoanParams(
            receiver,
            assets,
            dLoopCore.getLeveragedAssets(assets),
            debtTokenToCollateralSwapData,
            dLoopCore
        );
        bytes memory data = _encodeParamsToData(params);
        address debtToken = address(dLoopCore.debtToken());
        uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(debtToken);

        // This value is used to check if the shares increased after the flash loan
        uint256 sharesBeforeDeposit = dLoopCore.balanceOf(address(this));

        // Approve the flash lender to spend the flash loan amount of debt token from this contract
        ERC20(debtToken).forceApprove(
            address(flashLender),
            maxFlashLoanAmount +
                flashLender.flashFee(debtToken, maxFlashLoanAmount)
        );

        // The main logic will be done in the onFlashLoan function
        flashLender.flashLoan(this, debtToken, maxFlashLoanAmount, data);

        // Check if the shares increased after the flash loan
        uint256 sharesAfterDeposit = dLoopCore.balanceOf(address(this));
        if (sharesAfterDeposit <= sharesBeforeDeposit) {
            revert SharesNotIncreasedAfterFlashLoan(
                sharesBeforeDeposit,
                sharesAfterDeposit
            );
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
            revert ReceivedSharesNotMetMinReceiveAmount(
                shares,
                minOutputShares
            );
        }

        // Transfer the minted shares to the receiver
        SafeERC20.safeTransferFrom(dLoopCore, address(this), receiver, shares);

        // Return the shares minted
        return shares;
    }

    /* Flash loan entrypoint */

    /**
     * @dev Callback function for flash loans
     * @param initiator Address that initiated the flash loan
     * @param token Address of the flash-borrowed token
     * @param data Additional data passed to the flash loan
     * @return bytes32 The flash loan callback success bytes
     */
    function onFlashLoan(
        address initiator,
        address token,
        uint256, // amount (flash loan amount)
        uint256, // fee (flash loan fee)
        bytes calldata data
    ) external override returns (bytes32) {
        if (msg.sender != address(flashLender))
            revert UnknownLender(msg.sender, address(flashLender));
        if (initiator != address(this))
            revert UnknownInitiator(initiator, address(this));

        // Decode the flash loan params data
        FlashLoanParams memory flashLoanParams = _decodeDataToParams(data);
        DLoopCoreBase dLoopCore = flashLoanParams.dLoopCore;
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        // Make sure the input dLoopCore is compatible with this periphery contract
        if (token != address(debtToken))
            revert IncompatibleDLoopCoreDebtToken(token, address(debtToken));

        // Calculate the maxDebtInputAmount for slippage protection
        uint256 requiredAdditionalCollateralAmount = flashLoanParams
            .leveragedCollateralAmount -
            flashLoanParams.depositCollateralAmount;

        // Swap the flash loan debt token to the collateral token
        uint256 debtTokenAmountUsedInSwap = _swapExactOutput(
            debtToken,
            collateralToken,
            requiredAdditionalCollateralAmount, // exact output amount
            type(uint256).max, // no slippage protection
            address(this),
            block.timestamp,
            flashLoanParams.debtTokenToCollateralSwapData
        );

        // This value is used to check if the debt token balance increased after the deposit
        uint256 debtTokenBalanceBeforeDeposit = debtToken.balanceOf(
            address(this)
        );

        /**
         * Deposit the collateral token to the core vault
         *
         * The receiver is this periphery contract as the core contract will send both debt token and
         * the minted shares to the receiver. This contract needs the debt token to repay the flash loan.
         *
         * The minted shares will be sent to the receiver later (outside of the flash loan callback)
         */
        collateralToken.forceApprove(
            address(dLoopCore),
            flashLoanParams.leveragedCollateralAmount
        );
        dLoopCore.deposit(
            flashLoanParams.leveragedCollateralAmount,
            address(this)
        );

        // Debt token balance after deposit, which is used to sanity check the debt token balance increased after the deposit
        uint256 debtTokenBalanceAfterDeposit = debtToken.balanceOf(
            address(this)
        );

        // Make sure to receive the debt token from the core vault to repay the flash loan
        if (debtTokenBalanceAfterDeposit <= debtTokenBalanceBeforeDeposit) {
            revert DebtTokenBalanceNotIncreasedAfterDeposit(
                debtTokenBalanceBeforeDeposit,
                debtTokenBalanceAfterDeposit
            );
        }

        // Calculate the debt token received after the deposit
        uint256 debtTokenReceivedAfterDeposit = debtTokenBalanceAfterDeposit -
            debtTokenBalanceBeforeDeposit;

        // Make sure the debt token received after the deposit is not less than the debt token used in the swap
        // to allow repaying the flash loan
        if (debtTokenReceivedAfterDeposit < debtTokenAmountUsedInSwap) {
            revert DebtTokenReceivedNotMetUsedAmount(
                debtTokenReceivedAfterDeposit,
                debtTokenAmountUsedInSwap
            );
        }

        // Return the success bytes
        return FLASHLOAN_CALLBACK;
    }

    /**
     * @dev Encodes flash loan parameters to data
     * @param _flashLoanParams Flash loan parameters
     * @return data Encoded data
     */
    function _encodeParamsToData(
        FlashLoanParams memory _flashLoanParams
    ) internal pure returns (bytes memory data) {
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
    function _decodeDataToParams(
        bytes memory data
    ) internal pure returns (FlashLoanParams memory _flashLoanParams) {
        (
            _flashLoanParams.receiver,
            _flashLoanParams.depositCollateralAmount,
            _flashLoanParams.leveragedCollateralAmount,
            _flashLoanParams.debtTokenToCollateralSwapData,
            _flashLoanParams.dLoopCore
        ) = abi.decode(data, (address, uint256, uint256, bytes, DLoopCoreBase));
    }
}
