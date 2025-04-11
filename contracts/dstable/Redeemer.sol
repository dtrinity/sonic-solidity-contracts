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

import "@openzeppelin/contracts/access/AccessControl.sol";

import "contracts/common/IMintableERC20.sol";
import "./CollateralVault.sol";
import "./OracleAware.sol";

contract Redeemer is AccessControl, OracleAware {
    /* Core state */

    IMintableERC20 public dstable;
    uint8 public immutable dstableDecimals;
    CollateralVault public collateralVault;

    uint256 public immutable BASE_UNIT;

    /* Roles */

    bytes32 public constant REDEMPTION_MANAGER_ROLE =
        keccak256("REDEMPTION_MANAGER_ROLE");

    /* Errors */
    error DStableTransferFailed();
    error SlippageTooHigh(uint256 actualCollateral, uint256 minCollateral);

    /**
     * @notice Initializes the Redeemer contract
     * @param _collateralVault The address of the collateral vault
     * @param _dstable The address of the dStable stablecoin
     * @param _oracle The address of the price oracle
     * @dev Sets up initial roles and configuration for redemption functionality
     */
    constructor(
        address _collateralVault,
        address _dstable,
        IPriceOracleGetter _oracle
    ) OracleAware(_oracle, _oracle.BASE_CURRENCY_UNIT()) {
        collateralVault = CollateralVault(_collateralVault);
        dstable = IMintableERC20(_dstable);
        dstableDecimals = dstable.decimals();
        BASE_UNIT = _oracle.BASE_CURRENCY_UNIT();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        grantRole(REDEMPTION_MANAGER_ROLE, msg.sender);
    }

    /* Redeemer */

    /**
     * @notice Redeems dStable tokens for collateral from the caller
     * @param dstableAmount The amount of dStable to redeem
     * @param collateralAsset The address of the collateral asset
     * @param minCollateral The minimum amount of collateral to receive, used for slippage protection
     */
    function redeem(
        uint256 dstableAmount,
        address collateralAsset,
        uint256 minCollateral
    ) external onlyRole(REDEMPTION_MANAGER_ROLE) {
        // Transfer dStable from withdrawer to this contract
        if (!dstable.transferFrom(msg.sender, address(this), dstableAmount)) {
            revert DStableTransferFailed();
        }

        // Burn the dStable
        dstable.burn(dstableAmount);

        // Calculate collateral amount
        uint256 dstableValue = dstableAmountToBaseValue(dstableAmount);
        uint256 collateralAmount = collateralVault.assetAmountFromValue(
            dstableValue,
            collateralAsset
        );
        if (collateralAmount < minCollateral) {
            revert SlippageTooHigh(collateralAmount, minCollateral);
        }

        // Withdraw collateral from the vault
        collateralVault.withdrawTo(
            msg.sender,
            collateralAmount,
            collateralAsset
        );
    }

    /**
     * @notice Converts an amount of dStable tokens to its equivalent base value
     * @param dstableAmount The amount of dStable tokens to convert
     * @return The equivalent base value
     */
    function dstableAmountToBaseValue(
        uint256 dstableAmount
    ) public view returns (uint256) {
        return (dstableAmount * BASE_UNIT) / (10 ** dstableDecimals);
    }

    /* Admin */

    /**
     * @notice Sets the collateral vault address
     * @param _collateralVault The address of the new collateral vault
     */
    function setCollateralVault(
        address _collateralVault
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        collateralVault = CollateralVault(_collateralVault);
    }
}
