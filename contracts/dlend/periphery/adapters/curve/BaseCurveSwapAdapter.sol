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

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { SafeERC20 } from "contracts/dlend/periphery/treasury/libs/SafeERC20.sol";
import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IERC20WithPermit } from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { IPool } from "contracts/dlend/core/interfaces/IPool.sol";
import { Ownable } from "contracts/dlend/core/dependencies/openzeppelin/contracts/Ownable.sol";
import { IBaseCurveAdapter } from "contracts/dlend/periphery/adapters/curve/interfaces/IBaseCurveAdapter.sol";

/**
 * @title BaseCurveSwapAdapter
 * @notice Utility functions for adapters using Curve
 */
abstract contract BaseCurveSwapAdapter is Ownable, IBaseCurveAdapter {
    using SafeERC20 for IERC20;

    /* State Variables */
    /// The address of the Aave PoolAddressesProvider contract
    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;

    /// The address of the Aave Pool contract
    IPool public immutable POOL;

    /**
     * @dev Constructor
     * @param addressesProvider The address of the Aave PoolAddressesProvider contract
     * @param pool The address of the Aave Pool contract
     */
    constructor(IPoolAddressesProvider addressesProvider, address pool) {
        ADDRESSES_PROVIDER = addressesProvider;
        POOL = IPool(pool);
    }

    /**
     * @dev Get the vToken, sToken and aToken associated to the asset
     * @param asset The address of the asset
     * @return address The address of the VariableDebtToken, vToken
     * @return address The address of the StableDebtToken, sToken
     * @return address The address of the aToken
     */
    function _getReserveData(address asset) internal view virtual returns (address, address, address);

    /**
     * @dev Supply an amount of asset to the Aave Pool
     * @param asset The address of the asset to be supplied
     * @param amount The amount of the asset to be supplied
     * @param to The address receiving the aTokens
     * @param referralCode The referral code to pass to Aave
     */
    function _supply(address asset, uint256 amount, address to, uint16 referralCode) internal virtual;

    /**
     * @dev Pull the ATokens from the user and withdraws the underlying asset from the Aave Pool
     * @param reserve The address of the asset
     * @param user The address of the user to pull aTokens from
     * @param amount The amount of tokens to be pulled and withdrawn
     * @param permitInput struct containing the permit signature
     */
    function _pullATokenAndWithdraw(
        address reserve,
        address user,
        uint256 amount,
        PermitInput memory permitInput
    ) internal returns (uint256) {
        // If deadline is set to zero, assume there is no signature for permit
        if (permitInput.deadline != 0) {
            permitInput.aToken.permit(
                user,
                address(this),
                permitInput.value,
                permitInput.deadline,
                permitInput.v,
                permitInput.r,
                permitInput.s
            );
        }

        (, , address aToken) = _getReserveData(reserve);

        uint256 aTokenBalanceBefore = IERC20(aToken).balanceOf(address(this));
        IERC20(aToken).safeTransferFrom(user, address(this), amount);
        uint256 aTokenBalanceDiff = IERC20(aToken).balanceOf(address(this)) - aTokenBalanceBefore;

        POOL.withdraw(reserve, aTokenBalanceDiff, address(this));
        return aTokenBalanceDiff;
    }

    /**
     * @dev Renews the asset allowance in case the current allowance is below a given threshold
     * @param asset The address of the asset
     * @param minAmount The minimum required allowance to the Aave Pool
     */
    function _conditionalRenewAllowance(address asset, uint256 minAmount) internal {
        uint256 allowance = IERC20(asset).allowance(address(this), address(POOL));
        if (allowance < minAmount) {
            IERC20(asset).safeApprove(address(POOL), type(uint256).max);
        }
    }

    /**
     * @dev Emergency rescue for token stucked on this contract, as failsafe mechanism
     * - Funds should never remain in this contract more time than during transactions
     * - Only callable by the owner
     */
    function rescueTokens(IERC20 token) external onlyOwner {
        token.safeTransfer(owner(), token.balanceOf(address(this)));
    }
}
