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

/**
 * @title DLoopWithdrawerBase
 * @dev A helper contract for withdrawing assets from the core vault with flash loans
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
    error UnknownToken(address token, address dStable);
    error SharesNotDecreasedAfterFlashLoan(
        uint256 sharesBeforeWithdraw,
        uint256 sharesAfterWithdraw
    );
    error InsufficientOutput(uint256 received, uint256 expected);
    error UnexpectedIncreaseInDStable(
        uint256 dStableBalanceBefore,
        uint256 dStableBalanceAfter
    );
    error UnexpectedDecreaseInUnderlyingAsset(
        uint256 underlyingAssetBalanceBefore,
        uint256 underlyingAssetBalanceAfter
    );
    /* Structs */

    struct FlashLoanParams {
        address owner;
        address receiver;
        uint256 shares;
        uint256 assetsToRemoveFromLending;
        uint256 slippageTolerance; // ie. 1000 = 10%
        uint256 minReceiveAmount;
        bytes underlyingToDStableSwapData;
        DLoopCoreBase dLoopCore;
    }

    /**
     * @dev Constructor for the DLoopWithdrawerBase contract
     * @param _flashLender Address of the flash loan provider
     */
    constructor(IERC3156FlashLender _flashLender) Ownable(msg.sender) {
        flashLender = _flashLender;
    }

    /* Swap functions - Need to override in the child contract */

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
     * @dev Redeems shares from the core vault
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive the assets
     * @param owner Address that owns the shares
     * @param slippageTolerance Slippage tolerance for the swap
     * @param minReceiveAmount Minimum amount of assets to receive
     * @param underlyingToDStableSwapData Swap data from underlying asset to dStable
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return assets Amount of assets redeemed
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner,
        uint256 slippageTolerance,
        uint256 minReceiveAmount,
        bytes memory underlyingToDStableSwapData,
        DLoopCoreBase dLoopCore
    ) public returns (uint256 assets) {
        // Get dStable from the dLoopCore
        ERC20 dStable = dLoopCore.dStable();

        // Check that owner has approved this contract to spend their shares if caller is not owner
        if (owner != msg.sender) {
            // The allowance check will be done by the dLoopCore contract
            dLoopCore.approve(address(this), shares);
        }

        // Convert shares to assets
        uint256 finalAssetsRequired = dLoopCore.convertToAssets(shares);

        // Calculate the leveraged amount to remove from lending
        uint256 assetsToRemoveFromLending = (finalAssetsRequired *
            dLoopCore.TARGET_LEVERAGE_BPS()) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Prepare flash loan parameters
        FlashLoanParams memory params = FlashLoanParams(
            owner,
            receiver,
            shares,
            assetsToRemoveFromLending,
            slippageTolerance,
            minReceiveAmount,
            underlyingToDStableSwapData,
            dLoopCore
        );
        bytes memory data = _encodeParamsToData(params);
        uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(address(dStable));

        // Shares before withdrawal
        uint256 sharesBeforeWithdraw = dLoopCore.balanceOf(owner);

        // We need to approve the flash lender to spend the dStable
        // Reference: https://soliditydeveloper.com/eip-3156
        require(
            dStable.approve(
                address(flashLender),
                maxFlashLoanAmount +
                    flashLender.flashFee(address(dStable), maxFlashLoanAmount)
            ),
            "approve failed for flash lender in redeem"
        );

        // Execute flash loan - the remaining logic will be in the onFlashLoan function
        flashLender.flashLoan(this, address(dStable), maxFlashLoanAmount, data);

        // Shares after withdrawal
        uint256 sharesAfterWithdraw = dLoopCore.balanceOf(owner);

        if (sharesAfterWithdraw >= sharesBeforeWithdraw) {
            revert SharesNotDecreasedAfterFlashLoan(
                sharesBeforeWithdraw,
                sharesAfterWithdraw
            );
        }

        // Calculate actual assets withdrawn
        assets = finalAssetsRequired;
        return assets;
    }

    /**
     * @dev Withdraws assets from the core vault
     * @param assets Amount of assets to withdraw
     * @param receiver Address to receive the assets
     * @param owner Address that owns the shares
     * @param slippageTolerance Slippage tolerance for the swap
     * @param minReceiveAmount Minimum amount of assets to receive
     * @param underlyingToDStableSwapData Swap data from underlying asset to dStable
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return shares Amount of shares burned
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner,
        uint256 slippageTolerance,
        uint256 minReceiveAmount,
        bytes memory underlyingToDStableSwapData,
        DLoopCoreBase dLoopCore
    ) public returns (uint256 shares) {
        // Calculate the shares needed to withdraw the requested assets
        shares = dLoopCore.convertToShares(assets);

        // Call redeem with the calculated shares
        redeem(
            shares,
            receiver,
            owner,
            slippageTolerance,
            minReceiveAmount,
            underlyingToDStableSwapData,
            dLoopCore
        );

        return shares;
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
    ) public returns (bytes32) {
        if (msg.sender != address(flashLender))
            revert UnknownLender(msg.sender, address(flashLender));
        if (initiator != address(this))
            revert UnknownInitiator(initiator, address(this));

        // Decode the flash loan parameters
        FlashLoanParams memory flashLoanParams = _decodeDataToParams(data);
        DLoopCoreBase dLoopCore = flashLoanParams.dLoopCore;

        // Get underlying asset and dStable from the dLoopCore
        ERC20 underlyingAsset = dLoopCore.underlyingAsset();
        ERC20 dStable = dLoopCore.dStable();

        if (token != address(dStable))
            revert UnknownToken(token, address(dStable));

        // Track the underlying asset and dStable balance before any operations
        uint256 underlyingAssetBalanceBefore = underlyingAsset.balanceOf(
            address(this)
        );
        uint256 dStableBalanceBefore = dStable.balanceOf(address(this));

        // Execute the core withdrawal (this will burn the shares)
        dLoopCore.redeem(
            flashLoanParams.shares,
            address(this), // First receive to this contract
            flashLoanParams.owner
        );

        // Track the underlying asset and dStable balance after withdrawal
        uint256 underlyingAssetBalanceAfter = underlyingAsset.balanceOf(
            address(this)
        );
        uint256 dStableBalanceAfter = dStable.balanceOf(address(this));

        if (dStableBalanceAfter > dStableBalanceBefore) {
            revert UnexpectedIncreaseInDStable(
                dStableBalanceBefore,
                dStableBalanceAfter
            );
        }

        if (underlyingAssetBalanceAfter < underlyingAssetBalanceBefore) {
            revert UnexpectedDecreaseInUnderlyingAsset(
                underlyingAssetBalanceBefore,
                underlyingAssetBalanceAfter
            );
        }

        // Instead of getting the returned amount from redeem() as the withdrawn amount
        // we need to calculate the withdrawn amount based on the balance changes
        // to avoid the case when the lending pool has some issues
        // and return the wrong amount
        uint256 withdrawnAssets = underlyingAssetBalanceAfter -
            underlyingAssetBalanceBefore;
        uint256 dStableRepaymentAmount = dStableBalanceAfter -
            dStableBalanceBefore;

        // Slippage protection
        if (withdrawnAssets < flashLoanParams.minReceiveAmount) {
            revert InsufficientOutput(
                withdrawnAssets,
                flashLoanParams.minReceiveAmount
            );
        }

        // Transfer underlying assets to the receiver
        underlyingAsset.safeTransfer(flashLoanParams.receiver, withdrawnAssets);

        // Use some of the withdrawn assets to swap back to dStable to repay the flash loan
        uint256 estimatedInputAmount = (dStableRepaymentAmount *
            (
                (dLoopCore.getAssetPriceFromOracle(address(dStable)) *
                    (10 ** underlyingAsset.decimals()))
            )) /
            (dLoopCore.getAssetPriceFromOracle(address(underlyingAsset)) *
                (10 ** dStable.decimals()));

        // Calculate the max input amount with slippage tolerance
        uint256 maxIn = (estimatedInputAmount *
            (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
                flashLoanParams.slippageTolerance)) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        require(maxIn > 0, "maxIn is not positive");

        // Swap from underlying asset to dStable to repay the flash loan
        _swapExactOutput(
            underlyingAsset,
            dStable,
            dStableRepaymentAmount,
            maxIn,
            address(this),
            block.timestamp,
            flashLoanParams.underlyingToDStableSwapData
        );

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
            _flashLoanParams.assetsToRemoveFromLending,
            _flashLoanParams.slippageTolerance,
            _flashLoanParams.minReceiveAmount,
            _flashLoanParams.underlyingToDStableSwapData,
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
            _flashLoanParams.assetsToRemoveFromLending,
            _flashLoanParams.slippageTolerance,
            _flashLoanParams.minReceiveAmount,
            _flashLoanParams.underlyingToDStableSwapData,
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
