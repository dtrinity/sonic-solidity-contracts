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

import {IERC20Detailed} from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import {IERC20WithPermit} from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";
import {ICreditDelegationToken} from "contracts/dlend/core/interfaces/ICreditDelegationToken.sol";
import {BaseOdosBuyAdapter} from "./BaseOdosBuyAdapter.sol";
import {IOdosDebtSwapAdapter} from "./interfaces/IOdosDebtSwapAdapter.sol";
import {ReentrancyGuard} from "../../dependencies/openzeppelin/ReentrancyGuard.sol";
import {IOdosRouterV2} from "contracts/odos/interface/IOdosRouterV2.sol";
import {IAaveFlashLoanReceiver} from "../curve/interfaces/IAaveFlashLoanReceiver.sol";
import {SafeERC20} from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import {IPoolAddressesProvider} from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import {DataTypes} from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";

/**
 * @title OdosDebtSwapAdapter
 * @notice Odos Adapter to perform a swap of debt to another debt.
 **/
contract OdosDebtSwapAdapter is
    BaseOdosBuyAdapter,
    ReentrancyGuard,
    IAaveFlashLoanReceiver,
    IOdosDebtSwapAdapter
{
    using SafeERC20 for IERC20WithPermit;

    // unique identifier to track usage via flashloan events
    uint16 public constant REFERRER = 5936; // uint16(uint256(keccak256(abi.encode('debt-swap-adapter'))) / type(uint16).max)

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _swapRouter,
        address owner
    ) BaseOdosBuyAdapter(addressesProvider, pool, _swapRouter) {
        transferOwnership(owner);
        // set initial approval for all reserves
        address[] memory reserves = POOL.getReservesList();
        for (uint256 i = 0; i < reserves.length; i++) {
            IERC20WithPermit(reserves[i]).safeApprove(
                address(POOL),
                type(uint256).max
            );
        }
    }

    /**
     * @dev Implementation of the reserve data getter from the base adapter
     * @param asset The address of the asset
     * @return The address of the vToken, sToken and aToken
     */
    function _getReserveData(
        address asset
    ) internal view override returns (address, address, address) {
        DataTypes.ReserveData memory reserveData = POOL.getReserveData(asset);
        return (
            reserveData.variableDebtTokenAddress,
            reserveData.stableDebtTokenAddress,
            reserveData.aTokenAddress
        );
    }

    /**
     * @dev Implementation of the supply function from the base adapter
     * @param asset The address of the asset to be supplied
     * @param amount The amount of the asset to be supplied
     * @param to The address receiving the aTokens
     * @param referralCode The referral code to pass to Aave
     */
    function _supply(
        address asset,
        uint256 amount,
        address to,
        uint16 referralCode
    ) internal override {
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
        uint256 excessBefore = IERC20Detailed(debtSwapParams.newDebtAsset)
            .balanceOf(address(this));
        // delegate credit
        if (creditDelegationPermit.deadline != 0) {
            ICreditDelegationToken(creditDelegationPermit.debtToken)
                .delegationWithSig(
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
        (address vToken, address sToken, ) = _getReserveData(
            debtSwapParams.debtAsset
        );
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
            swapData: debtSwapParams.swapData
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
            flashParams.nestedFlashloanDebtAmount = debtSwapParams
                .maxNewDebtAmount;
            // Execute the flashloan with the extra collateral asset.
            _flash(
                flashParams,
                debtSwapParams.extraCollateralAsset,
                debtSwapParams.extraCollateralAmount
            );
        } else {
            // Execute the flashloan with the debt asset.
            _flash(
                flashParams,
                debtSwapParams.newDebtAsset,
                debtSwapParams.maxNewDebtAmount
            );
        }

        // use excess to repay parts of flash debt
        uint256 excessAfter = IERC20Detailed(debtSwapParams.newDebtAsset)
            .balanceOf(address(this));
        // with wrapped flashloans there is the chance of 1 wei inaccuracy on transfer & withdrawal
        // this might lead to a slight excess decrease
        uint256 excess = excessAfter > excessBefore
            ? excessAfter - excessBefore
            : 0;
        if (excess > 0) {
            _conditionalRenewAllowance(debtSwapParams.newDebtAsset, excess);
            POOL.repay(debtSwapParams.newDebtAsset, excess, 2, msg.sender);
        }
    }

    function _flash(
        FlashParams memory flashParams,
        address asset,
        uint256 amount
    ) internal virtual {
        bytes memory params = abi.encode(flashParams);
        address[] memory assets = new address[](1);
        assets[0] = asset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // no debt, 0 = no debt, 1 = stable, 2 = variable
        // execute flash loan
        POOL.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            REFERRER
        );
    }

    function _nestedFlash(
        address asset,
        uint256 amount,
        FlashParams memory params
    ) internal {
        bytes memory innerParams = abi.encode(params);
        address[] memory assets = new address[](1);
        assets[0] = asset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // no debt, 0 = no debt, 1 = stable, 2 = variable
        // execute flash loan
        POOL.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            innerParams,
            REFERRER
        );
    }

    function executeOperation(
        address[] memory assets,
        uint256[] memory amounts,
        uint256[] memory premiums,
        address initiator,
        bytes memory params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Callback only from POOL");
        require(initiator == address(this), "Initiator only this contract");

        uint256 amount = amounts[0];
        address asset = assets[0];
        uint256 amountToReturn = amount + premiums[0];

        FlashParams memory flashParams = abi.decode(params, (FlashParams));

        // nested flashloan when using extra collateral
        if (flashParams.nestedFlashloanDebtAsset != address(0)) {
            (, , address aToken) = _getReserveData(asset);
            // pull collateral from the user after flashloan because of potential reentrancy
            IERC20WithPermit(aToken).safeTransferFrom(
                flashParams.user,
                address(this),
                flashParams.debtRepayAmount
            );
            POOL.withdraw(asset, flashParams.debtRepayAmount, address(this));

            FlashParams memory innerFlashParams = FlashParams({
                debtAsset: flashParams.debtAsset,
                debtRepayAmount: flashParams.debtRepayAmount,
                debtRateMode: flashParams.debtRateMode,
                nestedFlashloanDebtAsset: address(0),
                nestedFlashloanDebtAmount: 0,
                user: flashParams.user,
                swapData: flashParams.swapData
            });
            _nestedFlash(
                flashParams.nestedFlashloanDebtAsset,
                flashParams.nestedFlashloanDebtAmount,
                innerFlashParams
            );

            // revert if returned amount is not enough to repay the flashloan
            require(
                IERC20WithPermit(asset).balanceOf(address(this)) >=
                    amountToReturn,
                "Insufficient amount to repay flashloan"
            );

            IERC20WithPermit(asset).safeApprove(address(POOL), amountToReturn);
            return true;
        }

        // Executing the original flashloan
        {
            // Swap debt
            _buyOnOdos(
                IERC20Detailed(asset),
                IERC20Detailed(flashParams.debtAsset),
                amount,
                flashParams.debtRepayAmount,
                flashParams.swapData
            );

            // Repay old debt
            IERC20WithPermit(flashParams.debtAsset).safeApprove(
                address(POOL),
                flashParams.debtRepayAmount
            );
            POOL.repay(
                flashParams.debtAsset,
                flashParams.debtRepayAmount,
                flashParams.debtRateMode,
                flashParams.user
            );

            // Borrow new debt to repay flashloan
            POOL.borrow(
                asset,
                amountToReturn,
                2, // variable rate mode
                REFERRER,
                flashParams.user
            );

            // revert if returned amount is not enough to repay the flashloan
            require(
                IERC20WithPermit(asset).balanceOf(address(this)) >=
                    amountToReturn,
                "Insufficient amount to repay flashloan"
            );

            IERC20WithPermit(asset).safeApprove(address(POOL), amountToReturn);
            return true;
        }
    }
}
