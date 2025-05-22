// SPDX-License-Identifier: MIT
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\\"\_\  \ \_\    \ \_\  \/\_____\    *
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
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/common/IMintableERC20.sol";
import "./CollateralVault.sol";
import "./OracleAware.sol";
import "contracts/common/BasisPointConstants.sol";

contract RedeemerWithFees is AccessControl, OracleAware {
    /* Constants */
    uint256 public immutable MAX_FEE_BPS;

    /* Core state */
    IMintableERC20 public dstable;
    uint8 public immutable dstableDecimals;
    CollateralVault public collateralVault;
    uint256 public immutable BASE_UNIT;

    /* Fee related state */
    address public feeReceiver;
    uint256 public redemptionFeeBps; // Fee in basis points

    /* Roles */
    bytes32 public constant REDEMPTION_MANAGER_ROLE =
        keccak256("REDEMPTION_MANAGER_ROLE");

    /* Events */
    event FeeReceiverUpdated(
        address indexed oldFeeReceiver,
        address indexed newFeeReceiver
    );
    event RedemptionFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event Redemption(
        address indexed redeemer,
        address indexed collateralAsset,
        uint256 dstableAmount,
        uint256 collateralAmountToRedeemer,
        uint256 feeAmountCollateral
    );

    /* Errors */
    error DStableTransferFailed();
    error SlippageTooHigh(uint256 actualCollateral, uint256 minCollateral);
    error FeeTooHigh(uint256 requestedFeeBps, uint256 maxFeeBps);
    error CollateralTransferFailed(
        address recipient,
        uint256 amount,
        address token
    );
    error CannotBeZeroAddress();

    /**
     * @notice Initializes the RedeemerWithFees contract
     * @param _collateralVault The address of the collateral vault
     * @param _dstable The address of the dStable stablecoin
     * @param _oracle The address of the price oracle
     * @param _initialFeeReceiver The initial address to receive redemption fees
     * @param _initialRedemptionFeeBps The initial redemption fee in basis points
     * @dev Sets up initial roles and configuration for redemption functionality
     */
    constructor(
        address _collateralVault,
        address _dstable,
        IPriceOracleGetter _oracle,
        address _initialFeeReceiver,
        uint256 _initialRedemptionFeeBps
    ) OracleAware(_oracle, _oracle.BASE_CURRENCY_UNIT()) {
        if (
            _collateralVault == address(0) ||
            _dstable == address(0) ||
            address(_oracle) == address(0)
        ) {
            revert CannotBeZeroAddress();
        }
        if (_initialFeeReceiver == address(0)) {
            revert CannotBeZeroAddress();
        }

        MAX_FEE_BPS = 5 * BasisPointConstants.ONE_PERCENT_BPS; // 5%

        if (_initialRedemptionFeeBps > MAX_FEE_BPS) {
            revert FeeTooHigh(_initialRedemptionFeeBps, MAX_FEE_BPS);
        }

        collateralVault = CollateralVault(_collateralVault);
        dstable = IMintableERC20(_dstable);
        dstableDecimals = dstable.decimals();
        BASE_UNIT = _oracle.BASE_CURRENCY_UNIT();

        feeReceiver = _initialFeeReceiver;
        redemptionFeeBps = _initialRedemptionFeeBps;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REDEMPTION_MANAGER_ROLE, msg.sender); // Grant to deployer as well

        emit FeeReceiverUpdated(address(0), _initialFeeReceiver);
        emit RedemptionFeeUpdated(0, _initialRedemptionFeeBps);
    }

    /* Public Redemption */

    /**
     * @notice Allows anyone to redeem dStable tokens for collateral, subject to a fee.
     * @param dstableAmount The amount of dStable to redeem.
     * @param collateralAsset The address of the collateral asset.
     * @param minNetCollateral The minimum amount of collateral to receive after fees, for slippage protection.
     */
    function redeem(
        uint256 dstableAmount,
        address collateralAsset,
        uint256 minNetCollateral
    ) external {
        uint256 dstableValue = dstableAmountToBaseValue(dstableAmount);
        uint256 totalCollateral = collateralVault.assetAmountFromValue(
            dstableValue,
            collateralAsset
        );
        // Calculate fee
        uint256 feeCollateral = 0;
        if (redemptionFeeBps > 0) {
            feeCollateral =
                (totalCollateral * redemptionFeeBps) /
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
            if (feeCollateral > totalCollateral) {
                // This should never happen
                revert FeeTooHigh(redemptionFeeBps, MAX_FEE_BPS);
            }
        }
        uint256 netCollateral = totalCollateral - feeCollateral;
        if (netCollateral < minNetCollateral) {
            revert SlippageTooHigh(netCollateral, minNetCollateral);
        }

        // Burn and withdraw net amount to redeemer
        _redeem(msg.sender, dstableAmount, collateralAsset, netCollateral);

        // Withdraw fee to feeReceiver
        if (feeCollateral > 0) {
            collateralVault.withdrawTo(
                feeReceiver,
                feeCollateral,
                collateralAsset
            );
        }

        emit Redemption(
            msg.sender,
            collateralAsset,
            dstableAmount,
            netCollateral,
            feeCollateral
        );
    }

    /* Protocol Redemption */

    /**
     * @notice Allows the REDEMPTION_MANAGER_ROLE to redeem dStable tokens for collateral without fees.
     * @param dstableAmount The amount of dStable to redeem.
     * @param collateralAsset The address of the collateral asset.
     * @param minCollateral The minimum amount of collateral to receive, for slippage protection.
     */
    function redeemAsProtocol(
        uint256 dstableAmount,
        address collateralAsset,
        uint256 minCollateral
    ) external onlyRole(REDEMPTION_MANAGER_ROLE) {
        uint256 dstableValue = dstableAmountToBaseValue(dstableAmount);
        uint256 totalCollateral = collateralVault.assetAmountFromValue(
            dstableValue,
            collateralAsset
        );
        if (totalCollateral < minCollateral) {
            revert SlippageTooHigh(totalCollateral, minCollateral);
        }

        // Burn and withdraw full amount to redeemer
        _redeem(msg.sender, dstableAmount, collateralAsset, totalCollateral);

        emit Redemption(
            msg.sender,
            collateralAsset,
            dstableAmount,
            totalCollateral,
            0
        );
    }

    /* Internal Core Redemption Logic */

    /**
     * @notice Internal helper to transfer dStable, burn it, and withdraw a specified collateral amount.
     * @param redeemerAddress The address performing the redemption (source for dStable and recipient of collateral).
     * @param dstableAmount The amount of dStable to redeem.
     * @param collateralAsset The address of the collateral asset.
     * @param collateralAmount The amount of collateral to withdraw to redeemer.
     */
    function _redeem(
        address redeemerAddress,
        uint256 dstableAmount,
        address collateralAsset,
        uint256 collateralAmount
    ) internal {
        if (
            !dstable.transferFrom(redeemerAddress, address(this), dstableAmount)
        ) {
            revert DStableTransferFailed();
        }
        dstable.burn(dstableAmount);
        collateralVault.withdrawTo(
            redeemerAddress,
            collateralAmount,
            collateralAsset
        );
    }

    /* Value Calculation */

    /**
     * @notice Converts an amount of dStable tokens to its equivalent base value using the oracle.
     * @param _dstableAmount The amount of dStable tokens to convert.
     * @return The equivalent base value.
     */
    function dstableAmountToBaseValue(
        uint256 _dstableAmount
    ) public view returns (uint256) {
        return (_dstableAmount * BASE_UNIT) / (10 ** dstableDecimals);
    }

    /* Admin Functions */

    /**
     * @notice Sets the collateral vault address.
     * @param _collateralVault The address of the new collateral vault.
     */
    function setCollateralVault(
        address _collateralVault
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_collateralVault == address(0)) {
            revert CannotBeZeroAddress();
        }
        collateralVault = CollateralVault(_collateralVault);
    }

    /**
     * @notice Sets the fee receiver address.
     * @param _newFeeReceiver The address of the new fee receiver.
     */
    function setFeeReceiver(
        address _newFeeReceiver
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newFeeReceiver == address(0)) {
            revert CannotBeZeroAddress();
        }
        address oldFeeReceiver = feeReceiver;
        feeReceiver = _newFeeReceiver;
        emit FeeReceiverUpdated(oldFeeReceiver, _newFeeReceiver);
    }

    /**
     * @notice Sets the redemption fee in basis points.
     * @param _newFeeBps The new redemption fee (e.g., 100 for 1%).
     */
    function setRedemptionFee(
        uint256 _newFeeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newFeeBps > MAX_FEE_BPS) {
            revert FeeTooHigh(_newFeeBps, MAX_FEE_BPS);
        }
        uint256 oldFeeBps = redemptionFeeBps;
        redemptionFeeBps = _newFeeBps;
        emit RedemptionFeeUpdated(oldFeeBps, _newFeeBps);
    }
}
