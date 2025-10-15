// SPDX-License-Identifier: AGPL-3.0
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

import { DataTypes } from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";
import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { BaseOdosSellAdapterV2 } from "./BaseOdosSellAdapterV2.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { ReentrancyGuard } from "../../dependencies/openzeppelin/ReentrancyGuard.sol";
import { IOdosWithdrawSwapAdapterV2 } from "./interfaces/IOdosWithdrawSwapAdapterV2.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title OdosWithdrawSwapAdapterV2
 * @notice Adapter to withdraw and swap using Odos with PT token support
 * @dev Supports regular tokens and PT tokens through composed Pendle + Odos swaps
 */
contract OdosWithdrawSwapAdapterV2 is BaseOdosSellAdapterV2, ReentrancyGuard, IOdosWithdrawSwapAdapterV2 {
    using SafeERC20 for IERC20;

    // unique identifier to track usage via events
    uint16 public constant REFERRER = 43983; // Different from other V2 adapters

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 swapRouter,
        address pendleRouter,
        address owner
    ) BaseOdosSellAdapterV2(addressesProvider, pool, swapRouter, pendleRouter) {
        transferOwnership(owner);
    }

    /**
     * @dev Implementation of the reserve data getter from the base adapter
     * @param asset The address of the asset
     * @return The address of the vToken, sToken and aToken
     */
    function _getReserveData(address asset) internal view override returns (address, address, address) {
        DataTypes.ReserveData memory reserveData = POOL.getReserveData(asset);
        return (reserveData.variableDebtTokenAddress, reserveData.stableDebtTokenAddress, reserveData.aTokenAddress);
    }

    /**
     * @dev Implementation of the supply function from the base adapter
     * @param asset The address of the asset to be supplied
     * @param amount The amount of the asset to be supplied
     * @param to The address receiving the aTokens
     * @param referralCode The referral code to pass to Aave
     */
    function _supply(address asset, uint256 amount, address to, uint16 referralCode) internal override {
        POOL.supply(asset, amount, to, referralCode);
    }

    /**
     * @notice Sets the oracle price deviation tolerance (governance only)
     * @dev Cannot exceed MAX_ORACLE_PRICE_TOLERANCE_BPS (5%)
     * @param newToleranceBps New tolerance in basis points (e.g., 300 = 3%)
     */
    function setOraclePriceTolerance(uint256 newToleranceBps) external onlyOwner {
        _setOraclePriceTolerance(newToleranceBps);
    }

    /// @inheritdoc IOdosWithdrawSwapAdapterV2
    function withdrawAndSwap(
        WithdrawSwapParamsV2 memory withdrawSwapParams,
        PermitInput memory permitInput
    ) external nonReentrant whenNotPaused {
        address user = msg.sender; // Capture the actual caller

        (, , address aToken) = _getReserveData(withdrawSwapParams.oldAsset);
        if (withdrawSwapParams.allBalanceOffset != 0) {
            uint256 balance = IERC20(aToken).balanceOf(user);
            withdrawSwapParams.oldAssetAmount = balance;
        }

        // Record balance before pulling assets for leftover calculation
        uint256 oldAssetBalanceBefore = IERC20(withdrawSwapParams.oldAsset).balanceOf(address(this));

        // pulls liquidity asset from the user and withdraw
        _pullATokenAndWithdraw(withdrawSwapParams.oldAsset, user, withdrawSwapParams.oldAssetAmount, permitInput);

        // Use adaptive swap which handles both regular and PT token swaps intelligently
        uint256 amountReceived = _executeAdaptiveSwap(
            IERC20Detailed(withdrawSwapParams.oldAsset),
            IERC20Detailed(withdrawSwapParams.newAsset),
            withdrawSwapParams.oldAssetAmount,
            withdrawSwapParams.minAmountToReceive,
            withdrawSwapParams.swapData
        );

        // Handle leftover old asset by re-supplying to pool (in case swap used less than expected)
        uint256 oldAssetBalanceAfter = IERC20(withdrawSwapParams.oldAsset).balanceOf(address(this));
        uint256 oldAssetExcess = oldAssetBalanceAfter > oldAssetBalanceBefore
            ? oldAssetBalanceAfter - oldAssetBalanceBefore
            : 0;
        if (oldAssetExcess > 0) {
            _conditionalRenewAllowance(withdrawSwapParams.oldAsset, oldAssetExcess);
            _supply(withdrawSwapParams.oldAsset, oldAssetExcess, user, REFERRER);
        }

        // transfer new asset to the user
        IERC20(withdrawSwapParams.newAsset).safeTransfer(user, amountReceived);
    }
}
