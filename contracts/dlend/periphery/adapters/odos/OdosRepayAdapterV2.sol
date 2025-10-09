// SPDX-License-Identifier: AGPL-3.0
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     ______   __  __       *
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
import { IOdosRepayAdapterV2 } from "./interfaces/IOdosRepayAdapterV2.sol";
import { BaseOdosBuyAdapterV2 } from "./BaseOdosBuyAdapterV2.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { IERC20WithPermit } from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { ReentrancyGuard } from "../../dependencies/openzeppelin/ReentrancyGuard.sol";
import { IAaveFlashLoanReceiver } from "../curve/interfaces/IAaveFlashLoanReceiver.sol";

/**
 * @title OdosRepayAdapterV2
 * @notice Implements the logic for repaying a debt using a different asset as source
 * @dev Supports PT tokens through composed Pendle + Odos swaps
 */
contract OdosRepayAdapterV2 is BaseOdosBuyAdapterV2, ReentrancyGuard, IAaveFlashLoanReceiver, IOdosRepayAdapterV2 {
    using SafeERC20 for IERC20;
    using SafeERC20 for IERC20WithPermit;

    // unique identifier to track usage via flashloan events
    uint16 public constant REFERRER = 43982; // Different from V1 and other adapters

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _swapRouter,
        address _pendleRouter,
        address owner
    ) BaseOdosBuyAdapterV2(addressesProvider, pool, _swapRouter, _pendleRouter) {
        transferOwnership(owner);
        // set initial approval for all reserves
        address[] memory reserves = POOL.getReservesList();
        for (uint256 i = 0; i < reserves.length; i++) {
            IERC20(reserves[i]).safeApprove(address(POOL), type(uint256).max);
        }
    }

    /**
     * @notice Sets the oracle price deviation tolerance (governance only)
     * @dev Cannot exceed MAX_ORACLE_PRICE_TOLERANCE_BPS (5%)
     * @param newToleranceBps New tolerance in basis points (e.g., 300 = 3%)
     */
    function setOraclePriceTolerance(uint256 newToleranceBps) external onlyOwner {
        _setOraclePriceTolerance(newToleranceBps);
    }

    /// @inheritdoc IOdosRepayAdapterV2
    function repayWithCollateral(
        RepayParamsV2 memory repayParams,
        PermitInput memory collateralATokenPermit
    ) external nonReentrant whenNotPaused {
        address user = msg.sender; // Capture the actual caller

        // Refresh the exact repayAmount using current debt state and optional allBalanceOffset
        repayParams.repayAmount = _getDebtRepayAmount(
            IERC20(repayParams.debtAsset),
            repayParams.rateMode,
            repayParams.allBalanceOffset,
            repayParams.repayAmount,
            user
        );

        if (!repayParams.withFlashLoan) {
            uint256 collateralBalanceBefore = IERC20(repayParams.collateralAsset).balanceOf(address(this));
            // Pull collateral aTokens from user and withdraw underlying to this contract
            uint256 collateralAmountReceived = _pullATokenAndWithdraw(
                repayParams.collateralAsset,
                user,
                repayParams.collateralAmount,
                collateralATokenPermit
            );

            // Use adaptive buy which handles both regular and PT token swaps intelligently
            _executeAdaptiveBuy(
                IERC20Detailed(repayParams.collateralAsset),
                IERC20Detailed(repayParams.debtAsset),
                collateralAmountReceived,
                repayParams.repayAmount,
                repayParams.swapData
            );

            // Repay the debt
            _conditionalRenewAllowance(repayParams.debtAsset, repayParams.repayAmount);
            POOL.repay(repayParams.debtAsset, repayParams.repayAmount, repayParams.rateMode, user);

            // Supply on behalf of the user in case of excess of collateral asset after the swap
            uint256 collateralBalanceAfter = IERC20(repayParams.collateralAsset).balanceOf(address(this));
            uint256 collateralExcess = collateralBalanceAfter > collateralBalanceBefore
                ? collateralBalanceAfter - collateralBalanceBefore
                : 0;
            if (collateralExcess > 0) {
                _conditionalRenewAllowance(repayParams.collateralAsset, collateralExcess);
                _supply(repayParams.collateralAsset, collateralExcess, user, REFERRER);
            }
        } else {
            // Flashloan of the collateral asset to use for repayment
            _flash(repayParams, collateralATokenPermit, user);
        }
    }

    /**
     * @dev Executes the repay with collateral after receiving the flash-borrowed assets
     * @dev Workflow:
     * 1. Buy debt asset by providing the flash-borrowed assets in exchange
     * 2. Repay debt
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

        (RepayParamsV2 memory repayParams, PermitInput memory collateralATokenPermit, address user) = abi.decode(
            params,
            (RepayParamsV2, PermitInput, address)
        );

        address flashLoanAsset = assets[0];
        uint256 flashLoanAmount = amounts[0];
        uint256 flashLoanPremium = premiums[0];

        // Record balance before swap on flashloan asset to compute amountSold
        uint256 balanceBefore = IERC20(flashLoanAsset).balanceOf(address(this));

        // Use adaptive buy which handles both regular and PT token swaps intelligently
        _executeAdaptiveBuy(
            IERC20Detailed(flashLoanAsset),
            IERC20Detailed(repayParams.debtAsset),
            flashLoanAmount,
            repayParams.repayAmount,
            repayParams.swapData
        );

        // Repay the debt
        _conditionalRenewAllowance(repayParams.debtAsset, repayParams.repayAmount);
        POOL.repay(repayParams.debtAsset, repayParams.repayAmount, repayParams.rateMode, user);

        // Determine amount of flashloan asset sold in the swap
        uint256 balanceAfter = IERC20(flashLoanAsset).balanceOf(address(this));
        uint256 amountSold = balanceBefore > balanceAfter ? balanceBefore - balanceAfter : 0;

        // Pull only the amount needed from the user to repay the flashloan: premium + amountSold
        _pullATokenAndWithdraw(flashLoanAsset, user, flashLoanPremium + amountSold, collateralATokenPermit);

        // Flashloan repayment
        _conditionalRenewAllowance(flashLoanAsset, flashLoanAmount + flashLoanPremium);
        return true;
    }

    /**
     * @dev Swaps the collateral asset and repays the debt of received asset from swap
     * @dev Workflow:
     * 1. Pull aToken collateral from user and withdraw from Pool
     * 2. Buy debt asset by providing the withdrawn collateral in exchange
     * 3. Repay debt
     * @param repayParams struct describing the debt swap
     * @param collateralATokenPermit Permit for withdrawing collateral token from the pool
     * @return The amount of withdrawn collateral sold in the swap
     */
    /**
     * @dev Triggers the flashloan passing encoded params for the repay with collateral
     * @param repayParams struct describing the repay swap
     * @param collateralATokenPermit optional permit for old collateral's aToken
     * @param user the address of the user initiating the repay
     */
    function _flash(
        RepayParamsV2 memory repayParams,
        PermitInput memory collateralATokenPermit,
        address user
    ) internal virtual {
        bytes memory params = abi.encode(repayParams, collateralATokenPermit, user);
        address[] memory assets = new address[](1);
        assets[0] = repayParams.collateralAsset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = repayParams.collateralAmount;
        uint256[] memory interestRateModes = new uint256[](1);
        interestRateModes[0] = 0;

        POOL.flashLoan(address(this), assets, amounts, interestRateModes, address(this), params, REFERRER);
    }

    /**
     * @dev Triggers the flashloan passing encoded params for the repay with collateral
     * @param repayParams struct describing the repay swap
     * @param collateralATokenPermit optional permit for old collateral's aToken
     */
    /**
     * @dev Implementation of the reserve data getter from the base adapter
     */
    function _getReserveData(address asset) internal view override returns (address, address, address) {
        DataTypes.ReserveData memory reserveData = POOL.getReserveData(asset);
        return (reserveData.variableDebtTokenAddress, reserveData.stableDebtTokenAddress, reserveData.aTokenAddress);
    }

    /**
     * @dev Returns the amount of debt to repay for the user
     * @param debtAsset The address of the asset to repay the debt
     * @param rateMode The interest rate mode of the debt (e.g. STABLE or VARIABLE)
     * @param buyAllBalanceOffset offset in calldata in case all debt is repaid, otherwise 0
     * @param debtRepayAmount The amount of debt to repay
     * @param user The address user for whom the debt is repaid
     * @return The amount of debt to be repaid
     */
    /**
     * @dev Implementation of the supply function from the base adapter
     */
    function _supply(address asset, uint256 amount, address to, uint16 referralCode) internal override {
        POOL.supply(asset, amount, to, referralCode);
    }

    /**
     * @dev Returns the amount of debt to repay for the user
     * @param debtAsset The address of the asset to repay the debt
     * @param rateMode The interest rate mode of the debt (e.g. STABLE or VARIABLE)
     * @param buyAllBalanceOffset offset in calldata in case all debt is repaid, otherwise 0
     * @param debtRepayAmount The amount of debt to repay
     * @param user The address user for whom the debt is repaid
     * @return The amount of debt to be repaid
     */
    function _getDebtRepayAmount(
        IERC20 debtAsset,
        uint256 rateMode,
        uint256 buyAllBalanceOffset,
        uint256 debtRepayAmount,
        address user
    ) internal view returns (uint256) {
        (address vDebtToken, address sDebtToken, ) = _getReserveData(address(debtAsset));

        address debtToken = DataTypes.InterestRateMode(rateMode) == DataTypes.InterestRateMode.STABLE
            ? sDebtToken
            : vDebtToken;
        uint256 currentDebt = IERC20(debtToken).balanceOf(user);

        if (buyAllBalanceOffset != 0) {
            debtRepayAmount = currentDebt;
        } else {
            // Sanity check to ensure the passed value `debtRepayAmount` is less than the current debt
            // when repaying the exact amount
            if (debtRepayAmount > currentDebt) {
                revert InsufficientOutputAfterComposedSwap(currentDebt, debtRepayAmount);
            }
        }

        return debtRepayAmount;
    }
}
