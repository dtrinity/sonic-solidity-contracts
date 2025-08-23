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
import { SafeERC20 } from "contracts/dlend/periphery/treasury/libs/SafeERC20.sol";
import { BaseCurveSellAdapter } from "contracts/dlend/periphery/adapters/curve/BaseCurveSellAdapter.sol";
import { ReentrancyGuard } from "contracts/dlend/periphery/treasury/libs/ReentrancyGuard.sol";
import { ICurveRouterNgPoolsOnlyV1 } from "contracts/dlend/periphery/adapters/curve/interfaces/ICurveRouterNgPoolsOnlyV1.sol";
import { DataTypes } from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";
import { IAaveFlashLoanReceiver } from "contracts/dlend/periphery/adapters/curve/interfaces/IAaveFlashLoanReceiver.sol";
import { ICurveLiquiditySwapAdapter } from "contracts/dlend/periphery/adapters/curve/interfaces/ICurveLiquiditySwapAdapter.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title CurveLiquiditySwapAdapter
 * @notice Adapter to swap liquidity using Curve
 */
contract CurveLiquiditySwapAdapter is
    BaseCurveSellAdapter,
    ReentrancyGuard,
    IAaveFlashLoanReceiver,
    ICurveLiquiditySwapAdapter
{
    using SafeERC20 for IERC20;

    // unique identifier to track usage via flashloan events
    uint16 public constant REFERRER = 43980; // uint16(uint256(keccak256(abi.encode('liquidity-swap-adapter'))) / type(uint16).max)

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        ICurveRouterNgPoolsOnlyV1 swapRouter,
        address owner
    ) BaseCurveSellAdapter(addressesProvider, pool, swapRouter) {
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

    /// @inheritdoc ICurveLiquiditySwapAdapter
    function swapLiquidity(
        LiquiditySwapParams memory liquiditySwapParams,
        PermitInput memory collateralATokenPermit
    ) external nonReentrant {
        // true if flashloan is needed to swap liquidity
        if (!liquiditySwapParams.withFlashLoan) {
            _swapAndDeposit(liquiditySwapParams, collateralATokenPermit);
        } else {
            // flashloan of the current collateral asset
            _flash(liquiditySwapParams, collateralATokenPermit);
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

        (LiquiditySwapParams memory liquiditySwapParams, PermitInput memory collateralATokenPermit) = abi.decode(
            params,
            (LiquiditySwapParams, PermitInput)
        );

        address flashLoanAsset = assets[0];
        uint256 flashLoanAmount = amounts[0];
        uint256 flashLoanPremium = premiums[0];

        // sell the flashLoanAmount minus the premium, so flashloan repayment is guaranteed
        // flashLoan premium stays in the contract
        uint256 amountReceived = _sellOnCurve(
            IERC20Detailed(flashLoanAsset),
            IERC20Detailed(liquiditySwapParams.newCollateralAsset),
            flashLoanAmount - flashLoanPremium,
            liquiditySwapParams.newCollateralAmount,
            liquiditySwapParams.route,
            liquiditySwapParams.swapParams
        );

        // supplies the received asset(newCollateralAsset) from swap to Aave Pool
        _conditionalRenewAllowance(liquiditySwapParams.newCollateralAsset, amountReceived);
        _supply(liquiditySwapParams.newCollateralAsset, amountReceived, liquiditySwapParams.user, REFERRER);

        // pulls flashLoanAmount amount of flash-borrowed asset from the user
        _pullATokenAndWithdraw(flashLoanAsset, liquiditySwapParams.user, flashLoanAmount, collateralATokenPermit);

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
     * @param liquiditySwapParams struct describing the liquidity swap
     * @param collateralATokenPermit Permit for aToken corresponding to old collateral asset from the user
     * @return The amount received from the swap of new collateral asset, that is now supplied to the Aave Pool
     */
    function _swapAndDeposit(
        LiquiditySwapParams memory liquiditySwapParams,
        PermitInput memory collateralATokenPermit
    ) internal returns (uint256) {
        uint256 collateralAmountReceived = _pullATokenAndWithdraw(
            liquiditySwapParams.collateralAsset,
            liquiditySwapParams.user,
            liquiditySwapParams.collateralAmountToSwap,
            collateralATokenPermit
        );

        // sell(exact in) old collateral asset to new collateral asset
        uint256 amountReceived = _sellOnCurve(
            IERC20Detailed(liquiditySwapParams.collateralAsset),
            IERC20Detailed(liquiditySwapParams.newCollateralAsset),
            collateralAmountReceived,
            liquiditySwapParams.newCollateralAmount,
            liquiditySwapParams.route,
            liquiditySwapParams.swapParams
        );

        // supply the received asset(newCollateralAsset) from swap to the Aave Pool
        _conditionalRenewAllowance(liquiditySwapParams.newCollateralAsset, amountReceived);
        _supply(liquiditySwapParams.newCollateralAsset, amountReceived, liquiditySwapParams.user, REFERRER);

        return amountReceived;
    }

    /**
     * @dev Triggers the flashloan passing encoded params for the collateral swap
     * @param liquiditySwapParams struct describing the liquidity swap
     * @param collateralATokenPermit optional permit for old collateral's aToken
     */
    function _flash(
        LiquiditySwapParams memory liquiditySwapParams,
        PermitInput memory collateralATokenPermit
    ) internal virtual {
        bytes memory params = abi.encode(liquiditySwapParams, collateralATokenPermit);
        address[] memory assets = new address[](1);
        assets[0] = liquiditySwapParams.collateralAsset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = liquiditySwapParams.collateralAmountToSwap;
        uint256[] memory interestRateModes = new uint256[](1);
        interestRateModes[0] = 0;

        POOL.flashLoan(address(this), assets, amounts, interestRateModes, address(this), params, REFERRER);
    }
}
