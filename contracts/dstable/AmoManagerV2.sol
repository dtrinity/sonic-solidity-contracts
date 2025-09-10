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

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./OracleAware.sol";
import "./CollateralVault.sol";
import "./AmoDebtToken.sol";
import "contracts/common/IMintableERC20.sol";

/**
 * @title AmoManagerV2
 * @notice Unified AMO operations manager for both stable AMO (dUSD mint/burn) and collateral AMO (borrow/repay)
 * @dev Provides atomic operations with invariant checks and unified debt token accounting
 */
contract AmoManagerV2 is OracleAware, ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;
    using EnumerableSet for EnumerableSet.AddressSet;

    /* Core state */

    address public amoMultisig;
    AmoDebtToken public immutable debtToken;
    IMintableERC20 public immutable dstable;
    EnumerableSet.AddressSet private _allowedVaults;
    EnumerableSet.AddressSet private _allowedEndpoints;
    uint256 public tolerance;

    /* Roles */

    bytes32 public constant AMO_MANAGER_ROLE = keccak256("AMO_MANAGER_ROLE");

    /* Events */

    event Borrowed(
        address indexed vault,
        address indexed endpoint,
        address indexed asset,
        uint256 collateralAmount,
        uint256 debtMinted
    );
    event Repaid(
        address indexed vault,
        address indexed endpoint,
        address indexed asset,
        uint256 collateralAmount,
        uint256 debtBurned
    );
    event AmoMultisigSet(address indexed oldMultisig, address indexed newMultisig);
    event VaultAllowedSet(address indexed vault, bool allowed);
    event EndpointAllowedSet(address indexed endpoint, bool allowed);
    event ToleranceSet(uint256 oldTolerance, uint256 newTolerance);

    /* Errors */

    error UnsupportedVault(address vault);
    error UnsupportedCollateral(address asset);
    error UnsupportedEndpoint(address endpoint);
    error InvariantViolation(uint256 pre, uint256 post);
    error InvalidMultisig(address multisig);

    /**
     * @notice Initializes the AmoManagerV2 contract
     * @param _oracle The oracle for price feeds
     * @param _debtToken The AMO debt token for unified accounting
     * @param _dstable The dUSD stablecoin token
     * @param _amoMultisig The initial AMO multisig address
     * @param _tolerance The tolerance for value conservation checks (in base units)
     */
    constructor(
        IPriceOracleGetter _oracle,
        AmoDebtToken _debtToken,
        IMintableERC20 _dstable,
        address _amoMultisig,
        uint256 _tolerance
    ) OracleAware(_oracle, _oracle.BASE_CURRENCY_UNIT()) {
        debtToken = _debtToken;
        dstable = _dstable;
        tolerance = _tolerance;

        if (_amoMultisig == address(0)) {
            revert InvalidMultisig(_amoMultisig);
        }
        amoMultisig = _amoMultisig;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /* Stable AMO Operations */

    /**
     * @notice Increases AMO supply by minting dUSD and equal debt tokens atomically
     * @param amount The amount of dUSD to mint (debt tokens minted will equal this in base value)
     * @dev Only callable by AMO_MANAGER_ROLE. Mints dUSD to this contract and debt to accounting vault
     */
    function increaseAmoSupply(uint256 amount) external onlyRole(AMO_MANAGER_ROLE) nonReentrant {
        // Convert dUSD amount to base value for debt token minting
        uint256 debtAmount = baseToDebtUnits(dstableAmountToBaseValue(amount));

        // Must have at least one allowed vault to receive debt tokens
        if (_allowedVaults.length() == 0) {
            revert UnsupportedVault(address(0));
        }

        // Get the first allowed vault as accounting vault
        address accountingVault = _allowedVaults.at(0);

        // Mint debt tokens to the accounting vault
        debtToken.mintToVault(accountingVault, debtAmount);

        // Mint dUSD to this contract
        dstable.mint(address(this), amount);
    }

    /**
     * @notice Decreases AMO supply by burning dUSD and equal debt tokens atomically
     * @param amount The amount of dUSD to burn (debt tokens burned will equal this in base value)
     * @dev Only callable by AMO_MANAGER_ROLE. Burns dUSD from this contract and debt from accounting vault
     */
    function decreaseAmoSupply(uint256 amount) external onlyRole(AMO_MANAGER_ROLE) nonReentrant {
        // Convert dUSD amount to base value for debt token burning
        uint256 debtAmount = baseToDebtUnits(dstableAmountToBaseValue(amount));

        // Must have at least one allowed vault to burn debt tokens from
        if (_allowedVaults.length() == 0) {
            revert UnsupportedVault(address(0));
        }

        // Get the first allowed vault as accounting vault
        address accountingVault = _allowedVaults.at(0);

        // Burn dUSD from this contract
        dstable.burnFrom(address(this), amount);

        // Burn debt tokens from the accounting vault
        debtToken.burnFromVault(accountingVault, debtAmount);
    }

    /* Collateral AMO Operations */

    /**
     * @notice Borrows collateral from vault to endpoint with invariant checks
     * @param vault The collateral vault to borrow from
     * @param endpoint The endpoint to receive the borrowed collateral
     * @param asset The collateral asset to borrow
     * @param amount The amount of collateral to borrow
     * @dev Enforces value conservation: vault total value must remain unchanged within tolerance
     */
    function borrowTo(
        address vault,
        address endpoint,
        address asset,
        uint256 amount
    ) external onlyRole(AMO_MANAGER_ROLE) nonReentrant {
        // Validate inputs
        if (!_allowedVaults.contains(vault)) {
            revert UnsupportedVault(vault);
        }
        if (!_allowedEndpoints.contains(endpoint)) {
            revert UnsupportedEndpoint(endpoint);
        }
        if (!CollateralVault(vault).isCollateralSupported(asset)) {
            revert UnsupportedCollateral(asset);
        }

        // Record pre-operation vault value
        uint256 preValue = CollateralVault(vault).totalValue();

        // Calculate debt amount to mint (equal to asset value)
        uint256 assetValue = CollateralVault(vault).assetValueFromAmount(amount, asset);
        uint256 debtAmount = baseToDebtUnits(assetValue);

        // Mint debt tokens to the vault
        debtToken.mintToVault(vault, debtAmount);

        // Withdraw collateral to endpoint
        CollateralVault(vault).withdrawTo(endpoint, amount, asset);

        // Record post-operation vault value
        uint256 postValue = CollateralVault(vault).totalValue();

        // Enforce invariant: total value should be conserved within tolerance
        if (!_withinTolerance(preValue, postValue)) {
            revert InvariantViolation(preValue, postValue);
        }

        emit Borrowed(vault, endpoint, asset, amount, debtAmount);
    }

    /**
     * @notice Repays borrowed collateral from endpoint to vault with invariant checks
     * @param vault The collateral vault to repay to
     * @param endpoint The endpoint providing the collateral for repayment
     * @param asset The collateral asset being repaid
     * @param amount The amount of collateral to repay
     * @dev Enforces value conservation: vault total value must remain unchanged within tolerance
     */
    function repayFrom(
        address vault,
        address endpoint,
        address asset,
        uint256 amount
    ) public onlyRole(AMO_MANAGER_ROLE) nonReentrant {
        // Validate inputs
        if (!_allowedVaults.contains(vault)) {
            revert UnsupportedVault(vault);
        }
        if (!_allowedEndpoints.contains(endpoint)) {
            revert UnsupportedEndpoint(endpoint);
        }
        if (!CollateralVault(vault).isCollateralSupported(asset)) {
            revert UnsupportedCollateral(asset);
        }

        // Record pre-operation vault value
        uint256 preValue = CollateralVault(vault).totalValue();

        // Transfer collateral from endpoint to vault
        IERC20Metadata(asset).safeTransferFrom(endpoint, vault, amount);

        // Calculate debt amount to burn (equal to asset value)
        uint256 assetValue = CollateralVault(vault).assetValueFromAmount(amount, asset);
        uint256 debtAmount = baseToDebtUnits(assetValue);

        // Burn debt tokens from the vault
        debtToken.burnFromVault(vault, debtAmount);

        // Record post-operation vault value
        uint256 postValue = CollateralVault(vault).totalValue();

        // Enforce invariant: total value should be conserved within tolerance
        if (!_withinTolerance(preValue, postValue)) {
            revert InvariantViolation(preValue, postValue);
        }

        emit Repaid(vault, endpoint, asset, amount, debtAmount);
    }

    /* Helper Functions */

    /**
     * @notice Converts base value to debt token units
     * @param baseValue The base value to convert
     * @return The equivalent amount in debt token units
     */
    function baseToDebtUnits(uint256 baseValue) public view returns (uint256) {
        uint8 debtDecimals = debtToken.decimals();
        return Math.mulDiv(baseValue, 10 ** debtDecimals, baseCurrencyUnit);
    }

    /**
     * @notice Converts dUSD amount to base value
     * @param dstableAmount The dUSD amount to convert
     * @return The equivalent base value
     */
    function dstableAmountToBaseValue(uint256 dstableAmount) public view returns (uint256) {
        uint8 dstableDecimals = dstable.decimals();
        return Math.mulDiv(dstableAmount, baseCurrencyUnit, 10 ** dstableDecimals);
    }

    /**
     * @notice Checks if two values are within tolerance
     * @param value1 First value
     * @param value2 Second value
     * @return Whether the values are within tolerance
     */
    function _withinTolerance(uint256 value1, uint256 value2) internal view returns (bool) {
        uint256 diff = value1 > value2 ? value1 - value2 : value2 - value1;
        return diff <= tolerance;
    }

    /* Admin Functions */

    /**
     * @notice Sets the AMO multisig address
     * @param newMultisig The new multisig address
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function setAmoMultisig(address newMultisig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newMultisig == address(0)) {
            revert InvalidMultisig(newMultisig);
        }
        address oldMultisig = amoMultisig;
        amoMultisig = newMultisig;
        emit AmoMultisigSet(oldMultisig, newMultisig);
    }

    /**
     * @notice Sets vault allowed status
     * @param vault The vault address
     * @param allowed Whether the vault should be allowed
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function setVaultAllowed(address vault, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (allowed) {
            _allowedVaults.add(vault);
        } else {
            _allowedVaults.remove(vault);
        }
        emit VaultAllowedSet(vault, allowed);
    }

    /**
     * @notice Sets endpoint allowed status
     * @param endpoint The endpoint address
     * @param allowed Whether the endpoint should be allowed
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function setEndpointAllowed(address endpoint, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (allowed) {
            _allowedEndpoints.add(endpoint);
        } else {
            _allowedEndpoints.remove(endpoint);
        }
        emit EndpointAllowedSet(endpoint, allowed);
    }

    /**
     * @notice Sets the tolerance for invariant checks
     * @param newTolerance The new tolerance value in base units
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function setTolerance(uint256 newTolerance) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldTolerance = tolerance;
        tolerance = newTolerance;
        emit ToleranceSet(oldTolerance, newTolerance);
    }

    /* View Functions */

    /**
     * @notice Returns all allowed vaults
     * @return Array of allowed vault addresses
     */
    function getAllowedVaults() external view returns (address[] memory) {
        return _allowedVaults.values();
    }

    /**
     * @notice Returns all allowed endpoints
     * @return Array of allowed endpoint addresses
     */
    function getAllowedEndpoints() external view returns (address[] memory) {
        return _allowedEndpoints.values();
    }

    /**
     * @notice Checks if a vault is allowed
     * @param vault The vault address to check
     * @return Whether the vault is allowed
     */
    function isVaultAllowed(address vault) external view returns (bool) {
        return _allowedVaults.contains(vault);
    }

    /**
     * @notice Checks if an endpoint is allowed
     * @param endpoint The endpoint address to check
     * @return Whether the endpoint is allowed
     */
    function isEndpointAllowed(address endpoint) external view returns (bool) {
        return _allowedEndpoints.contains(endpoint);
    }

    /**
     * @notice Returns the number of allowed vaults
     * @return The count of allowed vaults
     */
    function getAllowedVaultsLength() external view returns (uint256) {
        return _allowedVaults.length();
    }

    /**
     * @notice Returns the number of allowed endpoints
     * @return The count of allowed endpoints
     */
    function getAllowedEndpointsLength() external view returns (uint256) {
        return _allowedEndpoints.length();
    }

    /**
     * @notice Returns total debt token supply for telemetry
     * @return The total supply of debt tokens
     */
    function totalDebtSupply() external view returns (uint256) {
        return debtToken.totalSupply();
    }
}
