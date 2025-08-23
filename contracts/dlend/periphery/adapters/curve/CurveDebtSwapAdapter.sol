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

import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IERC20WithPermit } from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";
import { ICreditDelegationToken } from "contracts/dlend/core/interfaces/ICreditDelegationToken.sol";
import { BaseCurveBuyAdapter } from "contracts/dlend/periphery/adapters/curve/BaseCurveBuyAdapter.sol";
import { ICurveDebtSwapAdapter } from "contracts/dlend/periphery/adapters/curve/interfaces/ICurveDebtSwapAdapter.sol";
import { ReentrancyGuard } from "contracts/dlend/periphery/treasury/libs/ReentrancyGuard.sol";
import { ICurveRouterNgPoolsOnlyV1 } from "contracts/dlend/periphery/adapters/curve/interfaces/ICurveRouterNgPoolsOnlyV1.sol";
import { IAaveFlashLoanReceiver } from "contracts/dlend/periphery/adapters/curve/interfaces/IAaveFlashLoanReceiver.sol";
import { SafeERC20 } from "contracts/dlend/periphery/treasury/libs/SafeERC20.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { DataTypes } from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";

/**
 * @title CurveDebtSwapAdapter
 * @notice Curve Adapter to perform a swap of debt to another debt.
 **/
contract CurveDebtSwapAdapter is BaseCurveBuyAdapter, ReentrancyGuard, IAaveFlashLoanReceiver, ICurveDebtSwapAdapter {
    using SafeERC20 for IERC20WithPermit;

    // unique identifier to track usage via flashloan events
    uint16 public constant REFERRER = 5936; // uint16(uint256(keccak256(abi.encode('debt-swap-adapter'))) / type(uint16).max)

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        ICurveRouterNgPoolsOnlyV1 swapRouter,
        address owner
    ) BaseCurveBuyAdapter(addressesProvider, pool, swapRouter) {
        transferOwnership(owner);
        // set initial approval for all reserves
        address[] memory reserves = POOL.getReservesList();
        for (uint256 i = 0; i < reserves.length; i++) {
            IERC20WithPermit(reserves[i]).safeApprove(address(POOL), type(uint256).max);
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
     * @dev Swaps one type of debt to another. Therefore this methods performs the following actions in order:
     * 1. Delegate credit in new debt
     * 2. Flashloan in new debt
     * 3. swap new debt to old debt
     * 4. repay old debt
     * @param debtSwapParams the parameters describing the swap
     * @param creditDelegationPermit optional permit for credit delegation
     * @param collateralATokenPermit optional permit for collateral aToken
     */
    function swapDebt(
        DebtSwapParams memory debtSwapParams,
        CreditDelegationInput memory creditDelegationPermit,
        PermitInput memory collateralATokenPermit
    ) external {
        uint256 excessBefore = IERC20Detailed(debtSwapParams.newDebtAsset).balanceOf(address(this));
        // delegate credit
        if (creditDelegationPermit.deadline != 0) {
            ICreditDelegationToken(creditDelegationPermit.debtToken).delegationWithSig(
                msg.sender,
                address(this),
                creditDelegationPermit.value,
                creditDelegationPermit.deadline,
                creditDelegationPermit.v,
                creditDelegationPermit.r,
                creditDelegationPermit.s
            );
        }
        // Default to the entire debt if an amount greater than it is passed.
        (address vToken, address sToken, ) = _getReserveData(debtSwapParams.debtAsset);
        uint256 maxDebtRepayAmount = debtSwapParams.debtRateMode == 2
            ? IERC20WithPermit(vToken).balanceOf(msg.sender)
            : IERC20WithPermit(sToken).balanceOf(msg.sender);

        if (debtSwapParams.debtRepayAmount > maxDebtRepayAmount) {
            debtSwapParams.debtRepayAmount = maxDebtRepayAmount;
        }
        FlashParams memory flashParams = FlashParams({
            debtAsset: debtSwapParams.debtAsset,
            debtRepayAmount: debtSwapParams.debtRepayAmount,
            debtRateMode: debtSwapParams.debtRateMode,
            nestedFlashloanDebtAsset: address(0),
            nestedFlashloanDebtAmount: 0,
            user: msg.sender,
            route: debtSwapParams.route,
            swapParams: debtSwapParams.swapParams
        });

        // If we need extra collateral, execute the flashloan with the collateral asset instead of the debt asset.
        if (debtSwapParams.extraCollateralAsset != address(0)) {
            // Permit collateral aToken if needed.
            if (collateralATokenPermit.deadline != 0) {
                collateralATokenPermit.aToken.permit(
                    msg.sender,
                    address(this),
                    collateralATokenPermit.value,
                    collateralATokenPermit.deadline,
                    collateralATokenPermit.v,
                    collateralATokenPermit.r,
                    collateralATokenPermit.s
                );
            }
            flashParams.nestedFlashloanDebtAsset = debtSwapParams.newDebtAsset;
            flashParams.nestedFlashloanDebtAmount = debtSwapParams.maxNewDebtAmount;
            // Execute the flashloan with the extra collateral asset.
            _flash(flashParams, debtSwapParams.extraCollateralAsset, debtSwapParams.extraCollateralAmount);
        } else {
            // Execute the flashloan with the debt asset.
            _flash(flashParams, debtSwapParams.newDebtAsset, debtSwapParams.maxNewDebtAmount);
        }

        // use excess to repay parts of flash debt
        uint256 excessAfter = IERC20Detailed(debtSwapParams.newDebtAsset).balanceOf(address(this));
        // with wrapped flashloans there is the chance of 1 wei inaccuracy on transfer & withdrawal
        // this might lead to a slight excess decrease
        uint256 excess = excessAfter > excessBefore ? excessAfter - excessBefore : 0;
        if (excess > 0) {
            _conditionalRenewAllowance(debtSwapParams.newDebtAsset, excess);
            POOL.repay(debtSwapParams.newDebtAsset, excess, 2, msg.sender);
        }
    }

    function _flash(FlashParams memory flashParams, address asset, uint256 amount) internal virtual {
        bytes memory params = abi.encode(flashParams);

        address[] memory assets = new address[](1);
        assets[0] = asset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        uint256[] memory interestRateModes = new uint256[](1);
        // This is only true if there is no need for extra collateral.
        interestRateModes[0] = flashParams.nestedFlashloanDebtAsset == address(0) ? 2 : 0;

        POOL.flashLoan(address(this), assets, amounts, interestRateModes, flashParams.user, params, REFERRER);
    }

    /**
     * @notice Executes an operation after receiving the flash-borrowed assets
     * @dev Ensure that the contract can return the debt + premium, e.g., has
     *      enough funds to repay and has approved the Pool to pull the total amount
     * @param assets The addresses of the flash-borrowed assets
     * @param amounts The amounts of the flash-borrowed assets
     * @param initiator The address of the flashloan initiator
     * @param params The byte-encoded params passed when initiating the flashloan
     * @return True if the execution of the operation succeeds, false otherwise
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        if (msg.sender != address(POOL)) {
            revert CallerMustBePool(msg.sender, address(POOL));
        }
        if (initiator != address(this)) {
            revert InitiatorMustBeThis(initiator, address(this));
        }

        FlashParams memory flashParams = abi.decode(params, (FlashParams));

        // This is only non-zero if we flashed extra collateral.
        if (flashParams.nestedFlashloanDebtAsset != address(0)) {
            // Wrap the swap with a supply and withdraw.
            address collateralAsset = assets[0];
            uint256 collateralAmount = amounts[0];

            // Supply
            _supply(collateralAsset, collateralAmount, flashParams.user, REFERRER);

            // Execute the nested flashloan
            address newAsset = flashParams.nestedFlashloanDebtAsset;
            flashParams.nestedFlashloanDebtAsset = address(0);
            _flash(flashParams, newAsset, flashParams.nestedFlashloanDebtAmount);

            // Fetch and transfer back in the aToken to allow the pool to pull it.
            (, , address aToken) = _getReserveData(collateralAsset);
            IERC20WithPermit(aToken).safeTransferFrom(flashParams.user, address(this), collateralAmount); // Could be rounding error but it's insignificant
            POOL.withdraw(collateralAsset, collateralAmount, address(this));
            _conditionalRenewAllowance(collateralAsset, collateralAmount);
        } else {
            // There is no need for additional collateral, execute the swap.
            _swapAndRepay(flashParams, IERC20Detailed(assets[0]), amounts[0]);
        }
        return true;
    }

    /**
     * @dev Swaps the flashed token to the debt token & repays the debt.
     * @param swapParams Decoded swap parameters
     * @param newDebtAsset Address of token to be swapped
     * @param newDebtAmount Amount of the reserve to be swapped(flash loan amount)
     */
    function _swapAndRepay(
        FlashParams memory swapParams,
        IERC20Detailed newDebtAsset,
        uint256 newDebtAmount
    ) internal returns (uint256) {
        uint256 amountSold = _buyOnCurve(
            newDebtAsset,
            IERC20Detailed(swapParams.debtAsset),
            newDebtAmount,
            swapParams.debtRepayAmount,
            swapParams.route,
            swapParams.swapParams
        );

        _conditionalRenewAllowance(swapParams.debtAsset, swapParams.debtRepayAmount);

        POOL.repay(address(swapParams.debtAsset), swapParams.debtRepayAmount, swapParams.debtRateMode, swapParams.user);
        return amountSold;
    }
}
