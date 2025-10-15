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

import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { BaseOdosSellAdapterV2 } from "./BaseOdosSellAdapterV2.sol";
import { ReentrancyGuard } from "../../dependencies/openzeppelin/ReentrancyGuard.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { DataTypes } from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";
import { IAaveFlashLoanReceiver } from "../curve/interfaces/IAaveFlashLoanReceiver.sol";
import { IOdosLiquiditySwapAdapterV2 } from "./interfaces/IOdosLiquiditySwapAdapterV2.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title OdosLiquiditySwapAdapterV2
 * @notice Adapter to swap liquidity using Odos with PT token support
 */
contract OdosLiquiditySwapAdapterV2 is
    BaseOdosSellAdapterV2,
    ReentrancyGuard,
    IAaveFlashLoanReceiver,
    IOdosLiquiditySwapAdapterV2
{
    using SafeERC20 for IERC20;

    // unique identifier to track usage via flashloan events
    uint16 public constant REFERRER = 43981; // Different from V1 to distinguish

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 swapRouter,
        address pendleRouter,
        address owner
    ) BaseOdosSellAdapterV2(addressesProvider, pool, swapRouter, pendleRouter) {
        transferOwnership(owner);
        // set initial approval for all reserves
        address[] memory reserves = POOL.getReservesList();
        for (uint256 i = 0; i < reserves.length; i++) {
            IERC20(reserves[i]).safeApprove(address(POOL), type(uint256).max);
        }
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

    /// @inheritdoc IOdosLiquiditySwapAdapterV2
    function swapLiquidity(
        LiquiditySwapParamsV2 memory liquiditySwapParams,
        PermitInput memory collateralATokenPermit
    ) external nonReentrant whenNotPaused {
        if (liquiditySwapParams.allBalanceOffset != 0) {
            (, , address aToken) = _getReserveData(liquiditySwapParams.collateralAsset);
            uint256 balance = IERC20(aToken).balanceOf(msg.sender);

            liquiditySwapParams.collateralAmountToSwap = balance;
        }

        FlashParamsV2 memory flashParams = FlashParamsV2({
            liquiditySwapParams: liquiditySwapParams,
            collateralATokenPermit: collateralATokenPermit,
            user: msg.sender
        });

        // true if flashloan is needed to swap liquidity
        if (!liquiditySwapParams.withFlashLoan) {
            _swapAndDeposit(flashParams);
        } else {
            // flashloan of the current collateral asset
            _flash(flashParams);
        }
    }

    /**
     * @dev Executes the collateral swap after receiving the flash-borrowed assets
     * @dev Workflow:
     * 1. Sell flash-borrowed asset for new collateral asset
     * 2. Supply new collateral asset
     * 3. Pull aToken collateral from user and withdraw from Pool
     * 4. Repay flashloan
     * @param assets The addresses of the flash-borrowed assets
     * @param amounts The amounts of the flash-borrowed assets
     * @param premiums The premiums of the flash-borrowed assets
     * @param initiator The address of the flashloan initiator
     * @param params The byte-encoded params passed when initiating the flashloan
     * @return True if the execution of the operation succeeds, false otherwise
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        if (msg.sender != address(POOL)) {
            revert CallerMustBePool(msg.sender, address(POOL));
        }
        if (initiator != address(this)) {
            revert InitiatorMustBeThis(initiator, address(this));
        }

        FlashParamsV2 memory flashParams = abi.decode(params, (FlashParamsV2));
        LiquiditySwapParamsV2 memory liquiditySwapParams = flashParams.liquiditySwapParams;
        PermitInput memory collateralATokenPermit = flashParams.collateralATokenPermit;
        address user = flashParams.user;

        address flashLoanAsset = assets[0];
        uint256 flashLoanAmount = amounts[0];
        uint256 flashLoanPremium = premiums[0];

        // sell the flashLoanAmount minus the premium, so flashloan repayment is guaranteed
        // flashLoan premium stays in the contract
        uint256 amountToSwap = flashLoanAmount - flashLoanPremium;
        uint256 amountReceived = _executeAdaptiveSwap(
            IERC20Detailed(flashLoanAsset),
            IERC20Detailed(liquiditySwapParams.newCollateralAsset),
            amountToSwap,
            liquiditySwapParams.newCollateralAmount,
            liquiditySwapParams.swapData
        );

        // supplies the received asset(newCollateralAsset) from swap to Aave Pool
        _conditionalRenewAllowance(liquiditySwapParams.newCollateralAsset, amountReceived);
        _supply(liquiditySwapParams.newCollateralAsset, amountReceived, user, REFERRER);

        // pulls flashLoanAmount amount of flash-borrowed asset from the user
        _pullATokenAndWithdraw(flashLoanAsset, user, flashLoanAmount, collateralATokenPermit);

        // flashloan repayment
        _conditionalRenewAllowance(flashLoanAsset, flashLoanAmount + flashLoanPremium);
        return true;
    }

    /**
     * @dev Swaps the collateral asset and supplies the received asset to the Aave Pool
     * @dev Workflow:
     * 1. Pull aToken collateral from user and withdraw from Pool
     * 2. Sell asset for new collateral asset
     * 3. Supply new collateral asset
     * @param flashParams struct containing liquidity swap params, permit, and user address
     * @return The amount received from the swap of new collateral asset, that is now supplied to the Aave Pool
     */
    function _swapAndDeposit(FlashParamsV2 memory flashParams) internal returns (uint256) {
        LiquiditySwapParamsV2 memory liquiditySwapParams = flashParams.liquiditySwapParams;
        PermitInput memory collateralATokenPermit = flashParams.collateralATokenPermit;
        address user = flashParams.user;
        // Record balance before pulling collateral for leftover calculation
        uint256 collateralBalanceBefore = IERC20(liquiditySwapParams.collateralAsset).balanceOf(address(this));

        uint256 collateralAmountReceived = _pullATokenAndWithdraw(
            liquiditySwapParams.collateralAsset,
            user,
            liquiditySwapParams.collateralAmountToSwap,
            collateralATokenPermit
        );

        // sell(exact in) old collateral asset to new collateral asset using adaptive routing
        uint256 amountReceived = _executeAdaptiveSwap(
            IERC20Detailed(liquiditySwapParams.collateralAsset),
            IERC20Detailed(liquiditySwapParams.newCollateralAsset),
            collateralAmountReceived,
            liquiditySwapParams.newCollateralAmount,
            liquiditySwapParams.swapData
        );

        // supply the received asset(newCollateralAsset) from swap to the Aave Pool
        _conditionalRenewAllowance(liquiditySwapParams.newCollateralAsset, amountReceived);
        _supply(liquiditySwapParams.newCollateralAsset, amountReceived, user, REFERRER);

        // Handle leftover collateral by re-supplying to pool (similar to RepayAdapterV2 pattern)
        uint256 collateralBalanceAfter = IERC20(liquiditySwapParams.collateralAsset).balanceOf(address(this));
        uint256 collateralExcess = collateralBalanceAfter > collateralBalanceBefore
            ? collateralBalanceAfter - collateralBalanceBefore
            : 0;
        if (collateralExcess > 0) {
            _conditionalRenewAllowance(liquiditySwapParams.collateralAsset, collateralExcess);
            _supply(liquiditySwapParams.collateralAsset, collateralExcess, user, REFERRER);
        }

        return amountReceived;
    }

    /**
     * @dev Triggers the flashloan passing encoded params for the collateral swap
     * @param flashParams struct containing liquidity swap params, permit, and user address
     */
    function _flash(FlashParamsV2 memory flashParams) internal virtual {
        bytes memory params = abi.encode(flashParams);
        address[] memory assets = new address[](1);
        assets[0] = flashParams.liquiditySwapParams.collateralAsset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = flashParams.liquiditySwapParams.collateralAmountToSwap;
        uint256[] memory interestRateModes = new uint256[](1);
        interestRateModes[0] = 0;

        POOL.flashLoan(address(this), assets, amounts, interestRateModes, address(this), params, REFERRER);
    }
}
