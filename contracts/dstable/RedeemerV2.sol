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
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "contracts/common/IMintableERC20.sol";
import "contracts/common/BasisPointConstants.sol";
import "./CollateralVault.sol";
import "./OracleAware.sol";

/**
 * @title RedeemerV2
 * @notice Extended Redeemer with global pause and per-asset redemption pause controls
 */
contract RedeemerV2 is AccessControl, OracleAware, Pausable, ReentrancyGuard {
    /* Constants */
    uint256 public immutable MAX_FEE_BPS;

    /* Core state */

    IMintableERC20 public dstable;
    uint8 public immutable dstableDecimals;
    CollateralVault public collateralVault;

    /* Fee related state */
    address public feeReceiver;
    uint256 public defaultRedemptionFeeBps; // Default fee in basis points

    // Per-asset fee bps. Separately track whether an override is active to allow 0 bps overrides even if default > 0.
    mapping(address => uint256) public collateralRedemptionFeeBps; // Fee in basis points per collateral asset
    mapping(address => bool) public isCollateralFeeOverridden;

    /* Events */

    event AssetRedemptionPauseUpdated(address indexed asset, bool paused);
    event FeeReceiverUpdated(address indexed oldFeeReceiver, address indexed newFeeReceiver);
    event DefaultRedemptionFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event CollateralRedemptionFeeUpdated(address indexed collateralAsset, uint256 oldFeeBps, uint256 newFeeBps);
    event Redemption(
        address indexed redeemer,
        address indexed collateralAsset,
        uint256 dstableAmount,
        uint256 collateralAmountToRedeemer,
        uint256 feeAmountCollateral
    );
    event CollateralVaultSet(address indexed collateralVault);

    /* Roles */

    bytes32 public constant REDEMPTION_MANAGER_ROLE = keccak256("REDEMPTION_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /* Errors */
    error DStableTransferFailed();
    error SlippageTooHigh(uint256 actualCollateral, uint256 minCollateral);
    error AssetRedemptionPaused(address asset);
    error FeeTooHigh(uint256 requestedFeeBps, uint256 maxFeeBps);
    error CollateralTransferFailed(address recipient, uint256 amount, address token);
    error CannotBeZeroAddress();

    /* Overrides */

    // If true, redemption with this collateral asset is paused at the redeemer level
    mapping(address => bool) public assetRedemptionPaused;

    /**
     * @notice Initializes the RedeemerV2 contract
     * @param _collateralVault The address of the collateral vault
     * @param _dstable The address of the dStable stablecoin
     * @param _oracle The address of the price oracle
     * @param _initialFeeReceiver The initial address to receive redemption fees
     * @param _initialRedemptionFeeBps The initial redemption fee in basis points
     */
    constructor(
        address _collateralVault,
        address _dstable,
        IPriceOracleGetter _oracle,
        address _initialFeeReceiver,
        uint256 _initialRedemptionFeeBps
    ) OracleAware(_oracle, _oracle.BASE_CURRENCY_UNIT()) {
        if (_collateralVault == address(0) || _dstable == address(0) || address(_oracle) == address(0)) {
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

        // Initial fee configuration
        feeReceiver = _initialFeeReceiver;
        defaultRedemptionFeeBps = _initialRedemptionFeeBps;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        grantRole(REDEMPTION_MANAGER_ROLE, msg.sender);
        grantRole(PAUSER_ROLE, msg.sender);

        emit FeeReceiverUpdated(address(0), _initialFeeReceiver);
        emit DefaultRedemptionFeeUpdated(0, _initialRedemptionFeeBps);
    }

    /* Redeemer */

    function redeem(
        uint256 dstableAmount,
        address collateralAsset,
        uint256 minNetCollateral
    ) external whenNotPaused nonReentrant {
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
        uint256 totalCollateral = collateralVault.assetAmountFromValue(dstableValue, collateralAsset);

        uint256 currentFeeBps = isCollateralFeeOverridden[collateralAsset]
            ? collateralRedemptionFeeBps[collateralAsset]
            : defaultRedemptionFeeBps;

        uint256 feeCollateral = 0;
        if (currentFeeBps > 0) {
            feeCollateral = Math.mulDiv(totalCollateral, currentFeeBps, BasisPointConstants.ONE_HUNDRED_PERCENT_BPS);
        }
        uint256 netCollateral = totalCollateral - feeCollateral;
        if (netCollateral < minNetCollateral) {
            revert SlippageTooHigh(netCollateral, minNetCollateral);
        }

        // Burn and withdraw net amount to redeemer
        _redeem(msg.sender, dstableAmount, collateralAsset, netCollateral);

        // Withdraw fee to feeReceiver
        if (feeCollateral > 0) {
            collateralVault.withdrawTo(feeReceiver, feeCollateral, collateralAsset);
        }

        emit Redemption(msg.sender, collateralAsset, dstableAmount, netCollateral, feeCollateral);
    }

    function redeemAsProtocol(
        uint256 dstableAmount,
        address collateralAsset,
        uint256 minCollateral
    ) external onlyRole(REDEMPTION_MANAGER_ROLE) whenNotPaused nonReentrant {
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
        uint256 totalCollateral = collateralVault.assetAmountFromValue(dstableValue, collateralAsset);
        if (totalCollateral < minCollateral) {
            revert SlippageTooHigh(totalCollateral, minCollateral);
        }

        // Burn and withdraw full amount to redeemer
        _redeem(msg.sender, dstableAmount, collateralAsset, totalCollateral);

        emit Redemption(msg.sender, collateralAsset, dstableAmount, totalCollateral, 0);
    }

    function _redeem(
        address redeemerAddress,
        uint256 dstableAmount,
        address collateralAsset,
        uint256 collateralAmount
    ) internal {
        // Transfer dStable from redeemer to this contract
        if (!dstable.transferFrom(redeemerAddress, address(this), dstableAmount)) {
            revert DStableTransferFailed();
        }
        // Burn the dStable
        dstable.burn(dstableAmount);
        // Withdraw collateral from the vault
        collateralVault.withdrawTo(redeemerAddress, collateralAmount, collateralAsset);
    }

    function dstableAmountToBaseValue(uint256 dstableAmount) public view returns (uint256) {
        return Math.mulDiv(dstableAmount, baseCurrencyUnit, 10 ** dstableDecimals);
    }

    /* Views */
    function isAssetRedemptionEnabled(address asset) public view returns (bool) {
        if (!collateralVault.isCollateralSupported(asset)) return false;
        return !assetRedemptionPaused[asset];
    }

    /* Admin */
    function setCollateralVault(address _collateralVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_collateralVault == address(0)) {
            revert CannotBeZeroAddress();
        }
        collateralVault = CollateralVault(_collateralVault);
        emit CollateralVaultSet(_collateralVault);
    }

    function setAssetRedemptionPause(address asset, bool paused) external onlyRole(PAUSER_ROLE) {
        if (!collateralVault.isCollateralSupported(asset)) {
            revert CollateralVault.UnsupportedCollateral(asset);
        }
        assetRedemptionPaused[asset] = paused;
        emit AssetRedemptionPauseUpdated(asset, paused);
    }

    function setFeeReceiver(address _newFeeReceiver) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newFeeReceiver == address(0)) {
            revert CannotBeZeroAddress();
        }
        address oldFeeReceiver = feeReceiver;
        feeReceiver = _newFeeReceiver;
        emit FeeReceiverUpdated(oldFeeReceiver, _newFeeReceiver);
    }

    function setDefaultRedemptionFee(uint256 _newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
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
        isCollateralFeeOverridden[_collateralAsset] = true; // enable override, allowing 0 bps explicitly
        emit CollateralRedemptionFeeUpdated(_collateralAsset, oldFeeBps, _newFeeBps);
    }

    /**
     * @notice Clears a per-asset fee override so the default fee applies again
     * @param _collateralAsset The collateral asset for which to clear the override
     */
    function clearCollateralRedemptionFee(address _collateralAsset) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_collateralAsset == address(0)) {
            revert CannotBeZeroAddress();
        }
        uint256 oldFeeBps = collateralRedemptionFeeBps[_collateralAsset];
        collateralRedemptionFeeBps[_collateralAsset] = 0;
        isCollateralFeeOverridden[_collateralAsset] = false;
        emit CollateralRedemptionFeeUpdated(_collateralAsset, oldFeeBps, 0);
    }

    function pauseRedemption() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpauseRedemption() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
