// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IDStakeCollateralVault } from "./interfaces/IDStakeCollateralVault.sol";
import { IDStableConversionAdapter } from "./interfaces/IDStableConversionAdapter.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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
contract DStakeCollateralVault is IDStakeCollateralVault, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- Roles ---
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    // --- Errors ---
    error ZeroAddress();
    error AssetNotSupported(address asset);
    error AssetAlreadySupported(address asset);
    error NonZeroBalance(address asset);
    error CannotRescueRestrictedToken(address token);
    error ETHTransferFailed(address receiver, uint256 amount);

    // --- Events ---
    event TokenRescued(address indexed token, address indexed receiver, uint256 amount);
    event ETHRescued(address indexed receiver, uint256 amount);

    // --- State ---
    address public immutable dStakeToken; // The DStakeToken this vault serves
    address public immutable dStable; // The underlying dStable asset address

    address public router; // The DStakeRouter allowed to interact

    EnumerableSet.AddressSet private _supportedAssets; // Set of supported vault assets

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
    function totalValueInDStable() external view override returns (uint256 dStableValue) {
        uint256 totalValue = 0;
        uint256 len = _supportedAssets.length();
        for (uint256 i = 0; i < len; i++) {
            address vaultAsset = _supportedAssets.at(i);
            address adapterAddress = IAdapterProvider(router).vaultAssetToAdapter(vaultAsset);

            if (adapterAddress == address(0)) {
                // If there is no adapter configured, simply skip this asset to
                // preserve liveness. Anyone can dust this vault and we cannot
                // enforce that all assets have adapters before removal
                continue;
            }

            uint256 balance = IERC20(vaultAsset).balanceOf(address(this));
            if (balance > 0) {
                totalValue += IDStableConversionAdapter(adapterAddress).assetValueInDStable(vaultAsset, balance);
            }
        }
        return totalValue;
    }

    // --- External Functions (Router Interactions) ---

    /**
     * @notice Transfers `amount` of `vaultAsset` from this vault to `recipient`.
     * @dev Only callable by the registered router (ROUTER_ROLE).
     * @param vaultAsset The vault asset to transfer
     * @param amount Amount of tokens to transfer
     * @param recipient Address to receive the tokens
     */
    function sendAsset(address vaultAsset, uint256 amount, address recipient) external onlyRole(ROUTER_ROLE) {
        if (!_isSupported(vaultAsset)) revert AssetNotSupported(vaultAsset);
        IERC20(vaultAsset).safeTransfer(recipient, amount);
    }

    /**
     * @notice Adds a new supported vault asset. Can only be invoked by the router.
     * @dev Only callable by the registered router (ROUTER_ROLE).
     * @param vaultAsset Address of the vault asset to add
     */
    function addSupportedAsset(address vaultAsset) external onlyRole(ROUTER_ROLE) {
        if (vaultAsset == address(0)) revert ZeroAddress();
        if (_isSupported(vaultAsset)) revert AssetAlreadySupported(vaultAsset);

        _supportedAssets.add(vaultAsset);
        emit SupportedAssetAdded(vaultAsset);
    }

    /**
     * @notice Removes a supported vault asset. Can only be invoked by the router.
     * @dev Only callable by the registered router (ROUTER_ROLE).
     * @param vaultAsset Address of the vault asset to remove
     */
    function removeSupportedAsset(address vaultAsset) external onlyRole(ROUTER_ROLE) {
        if (!_isSupported(vaultAsset)) revert AssetNotSupported(vaultAsset);
        // NOTE: Previously this function reverted if the vault still held a
        // non-zero balance of the asset, causing a griefing / DoS vector:
        // anyone could deposit 1 wei of the token to block removal. The
        // check has been removed so governance can always delist an asset.

        _supportedAssets.remove(vaultAsset);
        emit SupportedAssetRemoved(vaultAsset);
    }

    // --- Governance Functions ---

    /**
     * @notice Sets the router address. Grants ROUTER_ROLE to new router and
     *         revokes it from the previous router.
     * @dev Only callable by DEFAULT_ADMIN_ROLE.
     * @param _newRouter Address of the new router
     */
    function setRouter(address _newRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
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
        return _supportedAssets.contains(asset);
    }

    // --- External Views ---

    /**
     * @notice Returns the vault asset at `index` from the internal supported set.
     *         Kept for backwards-compatibility with the previous public array getter.
     */
    function supportedAssets(uint256 index) external view override returns (address) {
        return _supportedAssets.at(index);
    }

    /**
     * @notice Returns the entire list of supported vault assets. Useful for UIs & off-chain tooling.
     */
    function getSupportedAssets() external view returns (address[] memory) {
        return _supportedAssets.values();
    }

    // --- Recovery Functions ---

    /**
     * @notice Rescues tokens accidentally sent to the contract
     * @dev Cannot rescue supported vault assets or the dStable token
     * @param token Address of the token to rescue
     * @param receiver Address to receive the rescued tokens
     * @param amount Amount of tokens to rescue
     */
    function rescueToken(
        address token,
        address receiver,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (receiver == address(0)) revert ZeroAddress();

        // Check if token is a supported asset
        if (_isSupported(token)) {
            revert CannotRescueRestrictedToken(token);
        }

        // Check if token is the dStable token
        if (token == dStable) {
            revert CannotRescueRestrictedToken(token);
        }

        // Rescue the token
        IERC20(token).safeTransfer(receiver, amount);
        emit TokenRescued(token, receiver, amount);
    }

    /**
     * @notice Rescues ETH accidentally sent to the contract
     * @param receiver Address to receive the rescued ETH
     * @param amount Amount of ETH to rescue
     */
    function rescueETH(address receiver, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (receiver == address(0)) revert ZeroAddress();

        (bool success, ) = receiver.call{ value: amount }("");
        if (!success) revert ETHTransferFailed(receiver, amount);

        emit ETHRescued(receiver, amount);
    }

    /**
     * @notice Returns the list of tokens that cannot be rescued
     * @return restrictedTokens Array of restricted token addresses
     */
    function getRestrictedRescueTokens() external view returns (address[] memory) {
        address[] memory assets = _supportedAssets.values();
        address[] memory restrictedTokens = new address[](assets.length + 1);

        // Add all supported assets
        for (uint256 i = 0; i < assets.length; i++) {
            restrictedTokens[i] = assets[i];
        }

        // Add dStable token
        restrictedTokens[assets.length] = dStable;

        return restrictedTokens;
    }

    /**
     * @notice Allows the contract to receive ETH
     */
    receive() external payable {}
}
