// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDStakeCollateralVault} from "./interfaces/IDStakeCollateralVault.sol";
import {IDStableConversionAdapter} from "./interfaces/IDStableConversionAdapter.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

// ---------------------------------------------------------------------------
// Internal interface to query the router's public mapping without importing the
// full router contract (avoids circular dependencies).
// ---------------------------------------------------------------------------
interface IAdapterProvider {
    function vaultAssetToAdapter(address) external view returns (address);
}

/**
 * @title DStakeCollateralVault
 * @notice Holds various yield-bearing/convertible ERC20 tokens (`vault assets`) managed by dSTAKE.
 * @dev Calculates the total value of these assets in terms of the underlying dStable asset
 *      using registered adapters. This contract is non-upgradeable but replaceable via
 *      DStakeToken governance.
 *      Uses AccessControl for role-based access control.
 */
contract DStakeCollateralVault is IDStakeCollateralVault, AccessControl {
    using SafeERC20 for IERC20;

    // --- Roles ---
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    // --- Errors ---
    error ZeroAddress();
    error AssetNotSupported(address asset);
    error AssetAlreadySupported(address asset);
    error NonZeroBalance(address asset);

    // --- State ---
    address public immutable dStakeToken; // The DStakeToken this vault serves
    address public immutable dStable; // The underlying dStable asset address

    address public router; // The DStakeRouter allowed to interact

    address[] public supportedAssets; // List of supported vault assets

    // --- Constructor ---
    constructor(address _dStakeVaultShare, address _dStableAsset) {
        if (_dStakeVaultShare == address(0) || _dStableAsset == address(0)) {
            revert ZeroAddress();
        }
        dStakeToken = _dStakeVaultShare;
        dStable = _dStableAsset;

        // Set up the DEFAULT_ADMIN_ROLE initially to the contract deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // --- External Views (IDStakeCollateralVault Interface) ---

    /**
     * @inheritdoc IDStakeCollateralVault
     */
    function totalValueInDStable()
        external
        view
        override
        returns (uint256 dStableValue)
    {
        uint256 totalValue = 0;
        for (uint i = 0; i < supportedAssets.length; i++) {
            address vaultAsset = supportedAssets[i];
            address adapterAddress = IAdapterProvider(router)
                .vaultAssetToAdapter(vaultAsset);
            if (adapterAddress != address(0)) {
                uint256 balance = IERC20(vaultAsset).balanceOf(address(this));
                if (balance > 0) {
                    totalValue += IDStableConversionAdapter(adapterAddress)
                        .assetValueInDStable(vaultAsset, balance);
                }
            }
        }
        return totalValue;
    }

    /**
     * @notice Returns the adapter address for a given vault asset by querying the router.
     * @dev Maintained for backwards-compatibility so that external callers/tests don't break.
     */
    function adapterForAsset(
        address vaultAsset
    ) external view returns (address) {
        return IAdapterProvider(router).vaultAssetToAdapter(vaultAsset);
    }

    // --- External Functions (Router Interactions) ---

    /**
     * @notice Transfers `amount` of `vaultAsset` from this vault to `recipient`.
     * @dev Only callable by the registered router (ROUTER_ROLE).
     */
    function sendAsset(
        address vaultAsset,
        uint256 amount,
        address recipient
    ) external onlyRole(ROUTER_ROLE) {
        if (!_isSupported(vaultAsset)) revert AssetNotSupported(vaultAsset);
        IERC20(vaultAsset).safeTransfer(recipient, amount);
    }

    /**
     * @notice Adds a new supported vault asset. Can only be invoked by the router.
     */
    function addSupportedAsset(
        address vaultAsset
    ) external onlyRole(ROUTER_ROLE) {
        if (vaultAsset == address(0)) revert ZeroAddress();
        if (_isSupported(vaultAsset)) revert AssetAlreadySupported(vaultAsset);

        supportedAssets.push(vaultAsset);
    }

    /**
     * @notice Removes a supported vault asset. Can only be invoked by the router.
     *         Requires the vault to hold zero balance of the asset.
     */
    function removeSupportedAsset(
        address vaultAsset
    ) external onlyRole(ROUTER_ROLE) {
        if (!_isSupported(vaultAsset)) revert AssetNotSupported(vaultAsset);
        if (IERC20(vaultAsset).balanceOf(address(this)) > 0) {
            revert NonZeroBalance(vaultAsset);
        }

        for (uint256 i = 0; i < supportedAssets.length; i++) {
            if (supportedAssets[i] == vaultAsset) {
                supportedAssets[i] = supportedAssets[
                    supportedAssets.length - 1
                ];
                supportedAssets.pop();
                break;
            }
        }
    }

    // --- Governance Functions ---

    /**
     * @notice Sets the router address. Grants ROUTER_ROLE to new router and
     *         revokes it from the previous router.
     */
    function setRouter(
        address _newRouter
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newRouter == address(0)) revert ZeroAddress();

        // Revoke role from old router
        if (router != address(0)) {
            _revokeRole(ROUTER_ROLE, router);
        }

        _grantRole(ROUTER_ROLE, _newRouter);
        router = _newRouter;
        emit RouterSet(_newRouter);
    }

    // --- Internal Utilities ---

    function _isSupported(address asset) private view returns (bool) {
        for (uint256 i = 0; i < supportedAssets.length; i++) {
            if (supportedAssets[i] == asset) {
                return true;
            }
        }
        return false;
    }
}
