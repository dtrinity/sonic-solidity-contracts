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
 * @title DLoopDepositorBase
 * @dev A helper contract for depositing leveraged assets into the core vault with flash loans
 */
abstract contract DLoopDepositorBase is IERC3156FlashBorrower, Ownable {
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
    error SharesNotIncreasedAfterFlashLoan(
        uint256 sharesBeforeDeposit,
        uint256 sharesAfterDeposit
    );

    /* Structs */

    struct FlashLoanParams {
        address receiver;
        uint256 depositAssetAmount;
        uint256 newTotalAssets;
        uint256 slippageTolerance; // ie. 1000 = 10%
        bytes dStableToUnderlyingSwapData;
        DLoopCoreBase dLoopCore;
    }

    /**
     * @dev Constructor for the DLoopDepositorBase contract
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

    /* Deposit */

    /**
     * @dev Deposits assets into the core vault
     * @param assets Amount of assets to deposit
     * @param receiver Address to receive the minted shares
     * @param slippageTolerance Slippage tolerance for the swap
     * @param dStableToUnderlyingSwapData Swap data from dStable to underlying asset
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return shares Amount of shares minted
     */
    function deposit(
        uint256 assets, // deposit amount
        address receiver,
        uint256 slippageTolerance,
        bytes memory dStableToUnderlyingSwapData,
        DLoopCoreBase dLoopCore
    ) public returns (uint256 shares) {
        // Get the underlying asset and dStable from the dLoopCore
        ERC20 underlyingAsset = dLoopCore.underlyingAsset();

        // Transfer the assets to the vault (need the allowance before calling this function)
        underlyingAsset.safeTransferFrom(msg.sender, address(this), assets);

        FlashLoanParams memory params = FlashLoanParams(
            receiver,
            assets,
            dLoopCore.getLeveragedAssets(assets),
            slippageTolerance,
            dStableToUnderlyingSwapData,
            dLoopCore
        );
        bytes memory data = _encodeParamsToData(params);
        ERC20 dStable = dLoopCore.dStable();
        uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(address(dStable));

        // Shares before deposit
        uint256 sharesBeforeDeposit = dLoopCore.balanceOf(receiver);

        // The remaining logic will be in the _onFlashLoan() function
        flashLender.flashLoan(this, address(dStable), maxFlashLoanAmount, data);

        // Shares after deposit
        uint256 sharesAfterDeposit = dLoopCore.balanceOf(receiver);

        if (sharesAfterDeposit <= sharesBeforeDeposit) {
            revert SharesNotIncreasedAfterFlashLoan(
                sharesBeforeDeposit,
                sharesAfterDeposit
            );
        }

        return sharesAfterDeposit - sharesBeforeDeposit;
    }

    /**
     * @dev Mints shares to the receiver by depositing assets to the core vault
     * @param shares Amount of shares to mint
     * @param receiver Address to receive the minted shares
     * @param slippageTolerance Slippage tolerance for the swap
     * @param dStableToUnderlyingSwapData Swap data from dStable to underlying asset
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return assets Amount of assets deposited
     */
    function mint(
        uint256 shares,
        address receiver,
        uint256 slippageTolerance,
        bytes memory dStableToUnderlyingSwapData,
        DLoopCoreBase dLoopCore
    ) public returns (uint256 assets) {
        assets = dLoopCore.convertToAssets(shares);
        deposit(
            assets,
            receiver,
            slippageTolerance,
            dStableToUnderlyingSwapData,
            dLoopCore
        );
        return assets;
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
    ) public returns (bytes32) {
        if (msg.sender != address(flashLender))
            revert UnknownLender(msg.sender, address(flashLender));
        if (initiator != address(this))
            revert UnknownInitiator(initiator, address(this));

        FlashLoanParams memory flashLoanParams = _decodeDataToParams(data);
        DLoopCoreBase dLoopCore = flashLoanParams.dLoopCore;
        ERC20 underlyingAsset = dLoopCore.underlyingAsset();
        ERC20 dStable = dLoopCore.dStable();

        if (token != address(dStable))
            revert UnknownToken(token, address(dStable));

        uint256 requiredAdditionalAssets = flashLoanParams.newTotalAssets -
            flashLoanParams.depositAssetAmount;

        uint256 estimatedInputAmount = (requiredAdditionalAssets *
            (
                (dLoopCore.getAssetPriceFromOracle(address(underlyingAsset)) *
                    (10 ** dStable.decimals()))
            )) /
            (dLoopCore.getAssetPriceFromOracle(address(dStable)) *
                (10 ** underlyingAsset.decimals()));

        // Calculate the max input amount with slippage tolerance
        uint256 maxIn = (estimatedInputAmount *
            (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
                flashLoanParams.slippageTolerance)) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        require(maxIn > 0, "maxIn is not positive");

        // Swap from dStable to the underlying asset
        _swapExactOutput(
            dStable,
            underlyingAsset,
            requiredAdditionalAssets,
            maxIn,
            address(this),
            block.timestamp,
            flashLoanParams.dStableToUnderlyingSwapData
        );

        // Approve the dLoopCore to spend leveraged assets
        underlyingAsset.approve(
            address(dLoopCore),
            flashLoanParams.newTotalAssets
        );

        dLoopCore.deposit(
            flashLoanParams.depositAssetAmount,
            flashLoanParams.receiver
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
            _flashLoanParams.receiver,
            _flashLoanParams.depositAssetAmount,
            _flashLoanParams.newTotalAssets,
            _flashLoanParams.slippageTolerance,
            _flashLoanParams.dStableToUnderlyingSwapData,
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
            _flashLoanParams.depositAssetAmount,
            _flashLoanParams.newTotalAssets,
            _flashLoanParams.slippageTolerance,
            _flashLoanParams.dStableToUnderlyingSwapData,
            _flashLoanParams.dLoopCore
        ) = abi.decode(
            data,
            (address, uint256, uint256, uint256, bytes, DLoopCoreBase)
        );
    }
}
