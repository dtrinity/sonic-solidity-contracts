// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDStakeCollateralVault} from "./interfaces/IDStakeCollateralVault.sol";
import {IDStableConversionAdapter} from "./interfaces/IDStableConversionAdapter.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

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
    error InvalidAdapter();
    error AssetNotSupported(address asset);
    error AssetAlreadySupported(address asset);
    error AdapterMismatch(address expected, address actual);
    error NonZeroBalance(address asset);

    // --- State ---
    address public immutable dStakeToken; // The DStakeToken this vault serves
    address public immutable dStable; // The underlying dStable asset address

    address public router; // The DStakeRouter allowed to interact

    mapping(address => address) public adapterForAsset; // vaultAsset => adapter
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
            address adapterAddress = adapterForAsset[vaultAsset];
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

    // --- External Functions (Router Interactions) ---

    /**
     * @notice Transfers `amount` of `vaultAsset` from this vault to the `recipient`.
     * @dev Only callable by the registered router.
     * @param vaultAsset The address of the vault asset to send.
     * @param amount The amount to send.
     * @param recipient The address to receive the asset.
     */
    function sendAsset(
        address vaultAsset,
        uint256 amount,
        address recipient
    ) external onlyRole(ROUTER_ROLE) {
        if (adapterForAsset[vaultAsset] == address(0)) {
            revert AssetNotSupported(vaultAsset);
        }
        IERC20(vaultAsset).safeTransfer(recipient, amount);
    }

    // --- External Functions (Governance) ---

    /**
     * @notice Sets the address of the DStakeRouter contract.
     * @dev Only callable by an address with the DEFAULT_ADMIN_ROLE.
     * @param _newRouter The address of the new router contract.
     */
    function setRouter(
        address _newRouter
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newRouter == address(0)) {
            revert ZeroAddress();
        }

        // Revoke the ROUTER_ROLE from the old router if it exists
        if (router != address(0)) {
            _revokeRole(ROUTER_ROLE, router);
        }

        // Grant the ROUTER_ROLE to the new router
        _grantRole(ROUTER_ROLE, _newRouter);

        router = _newRouter;
        emit RouterSet(_newRouter);
    }

    /**
     * @notice Adds support for a new `vaultAsset` and its associated conversion adapter.
     * @dev Only callable by an address with the DEFAULT_ADMIN_ROLE.
     * @param vaultAsset The address of the new vault asset to support.
     * @param adapterAddress The address of the IDStableConversionAdapter for this asset.
     */
    function addAdapter(
        address vaultAsset,
        address adapterAddress
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vaultAsset == address(0) || adapterAddress == address(0)) {
            revert ZeroAddress();
        }
        if (adapterForAsset[vaultAsset] != address(0)) {
            revert AssetAlreadySupported(vaultAsset);
        }

        // Validate adapter interface and asset match
        try IDStableConversionAdapter(adapterAddress).vaultAsset() returns (
            address reportedAsset
        ) {
            if (reportedAsset != vaultAsset) {
                revert AdapterMismatch(vaultAsset, reportedAsset);
            }
        } catch {
            revert InvalidAdapter();
        }

        adapterForAsset[vaultAsset] = adapterAddress;
        supportedAssets.push(vaultAsset);
        emit AdapterAdded(vaultAsset, adapterAddress);
    }

    /**
     * @notice Removes support for a `vaultAsset` and its adapter.
     * @dev Only callable by an address with the DEFAULT_ADMIN_ROLE.
     * @dev Requires the vault to hold zero balance of the asset being removed.
     * @param vaultAsset The address of the vault asset to remove support for.
     */
    function removeAdapter(
        address vaultAsset
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapterForAsset[vaultAsset] == address(0)) {
            revert AssetNotSupported(vaultAsset);
        }
        if (IERC20(vaultAsset).balanceOf(address(this)) > 0) {
            revert NonZeroBalance(vaultAsset);
        }

        delete adapterForAsset[vaultAsset];

        // Remove from supportedAssets array
        for (uint i = 0; i < supportedAssets.length; i++) {
            if (supportedAssets[i] == vaultAsset) {
                supportedAssets[i] = supportedAssets[
                    supportedAssets.length - 1
                ];
                supportedAssets.pop();
                break;
            }
        }
        emit AdapterRemoved(vaultAsset);
    }
}
