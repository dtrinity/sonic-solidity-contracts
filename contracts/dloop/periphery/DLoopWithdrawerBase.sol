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
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";

import {IERC3156FlashBorrower} from "./interface/flashloan/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "./interface/flashloan/IERC3156FlashLender.sol";
import {DLoopCoreBase} from "../core/DLoopCoreBase.sol";
import {SwapHelper, PriceGetter} from "./libraries/SwapHelper.sol";
/**
 * @title DLoopWithdrawerBase
 * @dev A helper contract for withdrawing assets from the core vault with flash loans
 *      - Suppose that the core contract has leverage of 3x, and the collateral token is WETH, debt token is dUSD, price of WETH is 1000, price of dUSD is 2000
 *      - ie, given user has 300 shares representing 300 WETH, and wants to withdraw 300 WETH, this contract will do a flash loan to get 200 * 2000 dUSD
 *        to repay the debt in the core vault, then withdraw 300 WETH from the core vault. The contract will swap 200 WETH to 200 * 2000 dUSD to repay the flash loan.
 *      - In the final state, the user has 100 WETH (300 - 200), and the core contract has 0 WETH as collateral, 0 dUSD as debt
 *      - NOTE: This contract only support withdraw() from DLoopCore contracts, not redeem()
 */
abstract contract DLoopWithdrawerBase is IERC3156FlashBorrower, Ownable {
    using SafeERC20 for ERC20;

    /* Constants */

    bytes32 public constant FLASHLOAN_CALLBACK =
        keccak256("ERC3156FlashBorrower.onFlashLoan");

    /* Core state */

    IERC3156FlashLender public immutable flashLender;

    /* Errors */

    error UnknownLender(address msgSender, address flashLender);
    error UnknownInitiator(address initiator, address thisContract);
    error IncompatibleDLoopCoreDebtToken(address currentDebtToken, address dLoopCoreDebtToken);
    error SharesNotDecreasedAfterFlashLoan(
        uint256 sharesBeforeWithdraw,
        uint256 sharesAfterWithdraw
    );
    error InsufficientOutput(uint256 received, uint256 expected);
    error UnexpectedIncreaseInDebtToken(
        uint256 debtTokenBalanceBefore,
        uint256 debtTokenBalanceAfter
    );
    error UnexpectedDecreaseInCollateralToken(
        uint256 collateralTokenBalanceBefore,
        uint256 collateralTokenBalanceAfter
    );
    error IncorrectSharesBurned(uint256 expected, uint256 actual);

    /* Structs */

    struct FlashLoanParams {
        address owner;
        address receiver;
        uint256 shares;
        uint256 collateralToRemoveFromLending;
        uint256 slippageTolerance; // ie. 1000 = 10%
        uint256 minReceiveAmount;
        bytes collateralToDebtTokenSwapData;
        DLoopCoreBase dLoopCore;
    }

    /**
     * @dev Constructor for the DLoopWithdrawerBase contract
     * @param _flashLender Address of the flash loan provider
     */
    constructor(IERC3156FlashLender _flashLender) Ownable(msg.sender) {
        flashLender = _flashLender;
    }

    /* Virtual functions */

    /**
     * @dev Swaps an exact amount of input assets for as much output assets as possible
     * @param inputToken Input asset
     * @param outputToken Output asset
     * @param amountOut Amount of input assets
     * @param amountInMaximum Minimum amount of output assets (slippage protection)
     * @param receiver Address to receive the output assets
     * @param deadline Deadline for the swap
     * @param extraData Additional data for the swap
     * @return amountIn Amount of input assets used for the swap
     */
    function _swapExactOutput(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256 deadline,
        bytes memory extraData
    ) internal virtual returns (uint256);
    
    /* Safety functions */

    /**
     * @dev Rescues tokens accidentally sent to the contract
     * @param token Address of the token to rescue
     * @param receiver Address to receive the rescued tokens
     */
    function rescueToken(address token, address receiver) public onlyOwner {
        ERC20(token).safeTransfer(
            receiver,
            ERC20(token).balanceOf(address(this))
        );
    }

    /* Withdraw */

    /**
     * @dev Redeems shares from the core vault with flash loans
     *      - The required debt token to withdraw will be flash loaned from the flash lender
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive the assets
     * @param slippageTolerance Slippage tolerance for the swap
     * @param minReceiveAmount Minimum amount of assets to receive
     * @param collateralToDebtTokenSwapData Swap data from collateral token to debt token
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return assets Amount of assets redeemed
     */
    function redeem(
        uint256 shares,
        address receiver,
        uint256 slippageTolerance,
        uint256 minReceiveAmount,
        bytes memory collateralToDebtTokenSwapData,
        DLoopCoreBase dLoopCore
    ) public returns (uint256 assets) {
        address owner = msg.sender;

        // Transfer the shares to the periphery contract to prepare for the redeeming process
        SafeERC20.safeTransferFrom(dLoopCore, owner, address(this), shares);

        // This amount is representing the leveraged amount
        uint256 collateralToRemoveFromLending = dLoopCore.convertToAssets(shares);

        // Create the flash loan params data
        FlashLoanParams memory params = FlashLoanParams(
            owner,
            receiver,
            shares,
            collateralToRemoveFromLending,
            slippageTolerance,
            minReceiveAmount,
            collateralToDebtTokenSwapData,
            dLoopCore
        );
        bytes memory data = _encodeParamsToData(params);
        ERC20 debtToken = dLoopCore.debtToken();
        uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(
            address(debtToken)
        );

        // This value is used to check if the shares decreased after the flash loan
        uint256 sharesBeforeWithdraw = dLoopCore.balanceOf(owner);

        // Approve the flash lender to spend the flash loan amount of debt token from this contract
        require(
            debtToken.approve(
                address(flashLender),
                maxFlashLoanAmount +
                    flashLender.flashFee(address(debtToken), maxFlashLoanAmount)
            ),
            "approve failed for flash lender in redeem"
        );

        // The main logic will be done in the onFlashLoan function
        flashLender.flashLoan(
            this,
            address(debtToken),
            maxFlashLoanAmount,
            data
        );

        // Check if the shares decreased after the flash loan
        uint256 sharesAfterWithdraw = dLoopCore.balanceOf(owner);
        if (sharesAfterWithdraw >= sharesBeforeWithdraw) {
            revert SharesNotDecreasedAfterFlashLoan(
                sharesBeforeWithdraw,
                sharesAfterWithdraw
            );
        }

        // Make sure the burned shares is exactly the shares amount
        uint256 actualBurnedShares = sharesBeforeWithdraw - sharesAfterWithdraw;
        if (actualBurnedShares != shares) {
            revert IncorrectSharesBurned(shares, actualBurnedShares);
        }

        // Return the assets removed from the lending pool
        assets = collateralToRemoveFromLending;
        return assets;
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

        // These values are used to sanity check the collateral token balance increased
        // and the debt token balance decreased after the redeem
        uint256 collateralTokenBalanceBefore = collateralToken.balanceOf(
            address(this)
        );
        uint256 debtTokenBalanceBefore = debtToken.balanceOf(address(this));

        // Calculate the max debt token amount to repay with slippage tolerance
        uint256 maxDebtAmountToRepay = SwapHelper.getAmountWithSlippageTolerance(
            flashLoanParams.collateralToRemoveFromLending,
            flashLoanParams.slippageTolerance
        );
        
        // Redeem the shares to get the collateral token
        // The core vault will also take the debt token from the periphery contract
        // to repay the debt and then withdraw the collateral token
        debtToken.forceApprove(
            address(dLoopCore),
            maxDebtAmountToRepay
        );
        dLoopCore.redeem(
            flashLoanParams.shares,
            address(this),
            flashLoanParams.owner
        );

        // Make sure the collateral token balance increased after the redeem
        uint256 collateralTokenBalanceAfter = collateralToken.balanceOf(
            address(this)
        );
        if (collateralTokenBalanceAfter <= collateralTokenBalanceBefore) {
            revert UnexpectedDecreaseInCollateralToken(
                collateralTokenBalanceBefore,
                collateralTokenBalanceAfter
            );
        }

        // Make sure the debt token balance decreased after the redeem
        // as it is used to repay the flash loan
        uint256 debtTokenBalanceAfter = debtToken.balanceOf(address(this));
        if (debtTokenBalanceAfter > debtTokenBalanceBefore) {
            revert UnexpectedIncreaseInDebtToken(
                debtTokenBalanceBefore,
                debtTokenBalanceAfter
            );
        }

        // Calculate the withdrawn collateral token amount after the redeem
        uint256 withdrawnCollateralTokenAmount = collateralTokenBalanceAfter -
            collateralTokenBalanceBefore;

        // Slippage protection for the withdrawn collateral token amount
        if (withdrawnCollateralTokenAmount < flashLoanParams.minReceiveAmount) {
            revert InsufficientOutput(
                withdrawnCollateralTokenAmount,
                flashLoanParams.minReceiveAmount
            );
        }

        // Calculate the max collateral token amount to swap with slippage tolerance
        uint256 repaidDebtTokenAmount = debtTokenBalanceAfter -
            debtTokenBalanceBefore;
        uint256 maxCollateralInputAmount = SwapHelper.estimateInputAmountFromExactOutputAmount(
            collateralToken,
            debtToken,
            repaidDebtTokenAmount,
            flashLoanParams.slippageTolerance,
            PriceGetter(address(dLoopCore))
        );
        require(maxCollateralInputAmount > 0, "maxCollateralInputAmount is not positive");

        // Swap the collateral token to the debt token to repay the flash loan
        _swapExactOutput(
            collateralToken,
            debtToken,
            repaidDebtTokenAmount,
            maxCollateralInputAmount,
            address(this),
            block.timestamp,
            flashLoanParams.collateralToDebtTokenSwapData
        );

        // Transfer the withdrawn collateral token to the receiver
        collateralToken.safeTransfer(flashLoanParams.receiver, withdrawnCollateralTokenAmount);

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
            _flashLoanParams.owner,
            _flashLoanParams.receiver,
            _flashLoanParams.shares,
            _flashLoanParams.collateralToRemoveFromLending,
            _flashLoanParams.slippageTolerance,
            _flashLoanParams.minReceiveAmount,
            _flashLoanParams.collateralToDebtTokenSwapData,
            _flashLoanParams.dLoopCore
        );
    }

    /**
     * @dev Decodes data to flash loan withdraw parameters
     * @param data Encoded data
     * @return _flashLoanParams Decoded flash loan parameters
     */
    function _decodeDataToParams(
        bytes memory data
    ) internal pure returns (FlashLoanParams memory _flashLoanParams) {
        (
            _flashLoanParams.owner,
            _flashLoanParams.receiver,
            _flashLoanParams.shares,
            _flashLoanParams.collateralToRemoveFromLending,
            _flashLoanParams.slippageTolerance,
            _flashLoanParams.minReceiveAmount,
            _flashLoanParams.collateralToDebtTokenSwapData,
            _flashLoanParams.dLoopCore
        ) = abi.decode(
            data,
            (
                address,
                address,
                uint256,
                uint256,
                uint256,
                uint256,
                bytes,
                DLoopCoreBase
            )
        );
    }
}
