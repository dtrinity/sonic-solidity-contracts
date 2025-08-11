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
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

import "contracts/common/IMintableERC20.sol";
import "contracts/common/BasisPointConstants.sol";
import "./CollateralVault.sol";
import "./OracleAware.sol";

/**
 * @title RedeemerV2
 * @notice Extended Redeemer with global pause and per-asset redemption pause controls
 */
contract RedeemerV2 is AccessControl, OracleAware, Pausable {
    /* Constants */
    uint256 public immutable MAX_FEE_BPS;

    /* Core state */

    IMintableERC20 public dstable;
    uint8 public immutable dstableDecimals;
    CollateralVault public collateralVault;

    /* Fee related state */
    address public feeReceiver;
    uint256 public defaultRedemptionFeeBps; // Default fee in basis points
    mapping(address => uint256) public collateralRedemptionFeeBps; // Fee in basis points per collateral asset

    /* Events */

    event AssetRedemptionPauseUpdated(address indexed asset, bool paused);
    event FeeReceiverUpdated(
        address indexed oldFeeReceiver,
        address indexed newFeeReceiver
    );
    event DefaultRedemptionFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event CollateralRedemptionFeeUpdated(
        address indexed collateralAsset,
        uint256 oldFeeBps,
        uint256 newFeeBps
    );
    event Redemption(
        address indexed redeemer,
        address indexed collateralAsset,
        uint256 dstableAmount,
        uint256 collateralAmountToRedeemer,
        uint256 feeAmountCollateral
    );

    /* Roles */

    bytes32 public constant REDEMPTION_MANAGER_ROLE =
        keccak256("REDEMPTION_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /* Errors */
    error DStableTransferFailed();
    error SlippageTooHigh(uint256 actualCollateral, uint256 minCollateral);
    error AssetRedemptionPaused(address asset);
    error FeeTooHigh(uint256 requestedFeeBps, uint256 maxFeeBps);
    error CollateralTransferFailed(
        address recipient,
        uint256 amount,
        address token
    );
    error CannotBeZeroAddress();

    /* Overrides */

    // If true, redemption with this collateral asset is paused at the redeemer level
    mapping(address => bool) public assetRedemptionPaused;

    /**
     * @notice Initializes the RedeemerV2 contract
     */
    constructor(
        address _collateralVault,
        address _dstable,
        IPriceOracleGetter _oracle
    ) OracleAware(_oracle, _oracle.BASE_CURRENCY_UNIT()) {
        if (
            _collateralVault == address(0) ||
            _dstable == address(0) ||
            address(_oracle) == address(0)
        ) {
            revert CannotBeZeroAddress();
        }

        MAX_FEE_BPS = 5 * BasisPointConstants.ONE_PERCENT_BPS; // 5%

        collateralVault = CollateralVault(_collateralVault);
        dstable = IMintableERC20(_dstable);
        dstableDecimals = dstable.decimals();

        // Default fee configuration
        feeReceiver = msg.sender;
        defaultRedemptionFeeBps = 0; // no fee by default for backward compatibility

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        grantRole(REDEMPTION_MANAGER_ROLE, msg.sender);
        grantRole(PAUSER_ROLE, msg.sender);
    }

    /* Redeemer */

    function redeem(
        uint256 dstableAmount,
        address collateralAsset,
        uint256 minNetCollateral
    ) external whenNotPaused {
        // Ensure the collateral asset is supported by the vault before any further processing
        if (!collateralVault.isCollateralSupported(collateralAsset)) {
            revert CollateralVault.UnsupportedCollateral(collateralAsset);
        }

        // Ensure the redeemer has not paused this asset for redemption
        if (assetRedemptionPaused[collateralAsset]) {
            revert AssetRedemptionPaused(collateralAsset);
        }

        // Calculate collateral amount and fee
        uint256 dstableValue = dstableAmountToBaseValue(dstableAmount);
        uint256 totalCollateral = collateralVault.assetAmountFromValue(
            dstableValue,
            collateralAsset
        );

        uint256 currentFeeBps = collateralRedemptionFeeBps[collateralAsset];
        if (currentFeeBps == 0) {
            currentFeeBps = defaultRedemptionFeeBps;
        }
        if (currentFeeBps > MAX_FEE_BPS) {
            revert FeeTooHigh(currentFeeBps, MAX_FEE_BPS);
        }

        uint256 feeCollateral = 0;
        if (currentFeeBps > 0) {
            feeCollateral = Math.mulDiv(
                totalCollateral,
                currentFeeBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );
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

    function redeemAsProtocol(
        uint256 dstableAmount,
        address collateralAsset,
        uint256 minCollateral
    ) external onlyRole(REDEMPTION_MANAGER_ROLE) whenNotPaused {
        // Ensure the collateral asset is supported by the vault before any further processing
        if (!collateralVault.isCollateralSupported(collateralAsset)) {
            revert CollateralVault.UnsupportedCollateral(collateralAsset);
        }

        // Ensure the redeemer has not paused this asset for redemption
        if (assetRedemptionPaused[collateralAsset]) {
            revert AssetRedemptionPaused(collateralAsset);
        }

        // Calculate collateral amount
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

    function _redeem(
        address redeemerAddress,
        uint256 dstableAmount,
        address collateralAsset,
        uint256 collateralAmount
    ) internal {
        // Transfer dStable from redeemer to this contract
        if (
            !dstable.transferFrom(redeemerAddress, address(this), dstableAmount)
        ) {
            revert DStableTransferFailed();
        }
        // Burn the dStable
        dstable.burn(dstableAmount);
        // Withdraw collateral from the vault
        collateralVault.withdrawTo(
            redeemerAddress,
            collateralAmount,
            collateralAsset
        );
    }

    function dstableAmountToBaseValue(
        uint256 dstableAmount
    ) public view returns (uint256) {
        return
            Math.mulDiv(dstableAmount, baseCurrencyUnit, 10 ** dstableDecimals);
    }

    /* Views */
    function isAssetRedemptionEnabled(
        address asset
    ) public view returns (bool) {
        if (!collateralVault.isCollateralSupported(asset)) return false;
        return !assetRedemptionPaused[asset];
    }

    /* Admin */
    function setCollateralVault(
        address _collateralVault
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_collateralVault == address(0)) {
            revert CannotBeZeroAddress();
        }
        collateralVault = CollateralVault(_collateralVault);
    }

    function setAssetRedemptionPause(
        address asset,
        bool paused
    ) external onlyRole(PAUSER_ROLE) {
        if (!collateralVault.isCollateralSupported(asset)) {
            revert CollateralVault.UnsupportedCollateral(asset);
        }
        assetRedemptionPaused[asset] = paused;
        emit AssetRedemptionPauseUpdated(asset, paused);
    }

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

    function setDefaultRedemptionFee(
        uint256 _newFeeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newFeeBps > MAX_FEE_BPS) {
            revert FeeTooHigh(_newFeeBps, MAX_FEE_BPS);
        }
        uint256 oldFeeBps = defaultRedemptionFeeBps;
        defaultRedemptionFeeBps = _newFeeBps;
        emit DefaultRedemptionFeeUpdated(oldFeeBps, _newFeeBps);
    }

    function setCollateralRedemptionFee(
        address _collateralAsset,
        uint256 _newFeeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_collateralAsset == address(0)) {
            revert CannotBeZeroAddress();
        }
        if (_newFeeBps > MAX_FEE_BPS) {
            revert FeeTooHigh(_newFeeBps, MAX_FEE_BPS);
        }
        uint256 oldFeeBps = collateralRedemptionFeeBps[_collateralAsset];
        collateralRedemptionFeeBps[_collateralAsset] = _newFeeBps;
        emit CollateralRedemptionFeeUpdated(
            _collateralAsset,
            oldFeeBps,
            _newFeeBps
        );
    }

    function pauseRedemption() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpauseRedemption() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
