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
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./OracleAware.sol";
import "./CollateralVault.sol";
import "./AmoDebtToken.sol";
import "../common/IMintableERC20.sol";

/**
 * @title AmoManagerV2
 * @notice Unified AMO operations manager for both stable AMO (dUSD mint/burn) and collateral AMO (borrow/repay)
 * @dev Provides atomic operations with invariant checks and unified debt token accounting
 */
contract AmoManagerV2 is OracleAware, ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;
    using EnumerableSet for EnumerableSet.AddressSet;

    /* Core state */

    AmoDebtToken public immutable debtToken;
    IMintableERC20 public immutable dstable;
    address public collateralVault;
    EnumerableSet.AddressSet private _allowedAmoWallets;
    uint256 public tolerance;

    /* Roles */

    bytes32 public constant AMO_INCREASE_ROLE = keccak256("AMO_INCREASE_ROLE");
    bytes32 public constant AMO_DECREASE_ROLE = keccak256("AMO_DECREASE_ROLE");

    /* Events */

    event Borrowed(
        address indexed vault,
        address indexed wallet,
        address indexed asset,
        uint256 collateralAmount,
        uint256 debtMinted
    );
    event Repaid(
        address indexed vault,
        address indexed wallet,
        address indexed asset,
        uint256 collateralAmount,
        uint256 debtBurned
    );
    event CollateralVaultSet(address indexed oldVault, address indexed newVault);
    event AmoWalletAllowedSet(address indexed wallet, bool allowed);
    event ToleranceSet(uint256 oldTolerance, uint256 newTolerance);

    /* Errors */

    error UnsupportedVault(address vault);
    error UnsupportedCollateral(address asset);
    error UnsupportedAmoWallet(address wallet);
    error DebtTokenProhibited();
    error InvariantViolation(uint256 pre, uint256 post);
    error SlippageDebtMintTooLow(uint256 actualDebtMinted, uint256 minDebtMinted);
    error SlippageDebtBurnTooHigh(uint256 actualDebtBurned, uint256 maxDebtBurned);

    /**
     * @notice Initializes the AmoManagerV2 contract
     * @param _oracle The oracle for price feeds
     * @param _debtToken The AMO debt token for unified accounting
     * @param _dstable The dUSD stablecoin token
     * @param _collateralVault The single accounting collateral vault address
     */
    constructor(
        IPriceOracleGetter _oracle,
        AmoDebtToken _debtToken,
        IMintableERC20 _dstable,
        address _collateralVault
    ) OracleAware(_oracle, _oracle.BASE_CURRENCY_UNIT()) {
        debtToken = _debtToken;
        dstable = _dstable;
        // Set tolerance to 1 base unit to allow for minimal rounding differences independent of decimals
        tolerance = 1;

        if (_collateralVault == address(0)) {
            revert UnsupportedVault(_collateralVault);
        }
        collateralVault = _collateralVault;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /* Stable AMO Operations */

    /**
     * @notice Increases AMO supply by minting dUSD to a wallet and equal debt tokens to the vault atomically
     * @param amount The amount of dUSD to mint (debt tokens minted will equal this in base value)
     * @param wallet The AMO wallet to receive minted dUSD
     * @dev Only callable by AMO_INCREASE_ROLE. Ensures debt minted equals dUSD value
     */
    function increaseAmoSupply(uint256 amount, address wallet) external onlyRole(AMO_INCREASE_ROLE) nonReentrant {
        // Validate inputs
        if (!_allowedAmoWallets.contains(wallet)) {
            revert UnsupportedAmoWallet(wallet);
        }

        // Convert dUSD amount to base value for debt token minting
        uint256 dstableBaseValue = dstableAmountToBaseValue(amount);
        uint256 debtAmount = baseToDebtUnits(dstableBaseValue);

        // Record initial supplies
        uint256 preDebtSupply = debtToken.totalSupply();
        uint256 preDstableSupply = dstable.totalSupply();

        // Mint debt tokens to the accounting vault
        debtToken.mintToVault(collateralVault, debtAmount);

        // Mint dUSD to the AMO wallet
        dstable.mint(wallet, amount);

        // Verify the supplies increased correctly
        uint256 postDebtSupply = debtToken.totalSupply();
        uint256 postDstableSupply = dstable.totalSupply();

        // Invariant: debt token increase must match dUSD increase in base value terms
        uint256 actualDebtIncrease = postDebtSupply - preDebtSupply;
        uint256 actualDstableIncrease = postDstableSupply - preDstableSupply;
        uint256 expectedDebtFromDstable = baseToDebtUnits(dstableAmountToBaseValue(actualDstableIncrease));

        // Allow for minimal rounding difference
        if (
            actualDebtIncrease + tolerance < expectedDebtFromDstable ||
            actualDebtIncrease > expectedDebtFromDstable + tolerance
        ) {
            revert InvariantViolation(expectedDebtFromDstable, actualDebtIncrease);
        }
    }

    /**
     * @notice Decreases AMO supply by pulling dUSD from a wallet and burning equal debt tokens atomically
     * @param amount The amount of dUSD to burn (debt tokens burned will equal this in base value)
     * @param wallet The AMO wallet to pull dUSD from (must approve manager)
     * @dev Only callable by AMO_DECREASE_ROLE. Ensures debt burned equals dUSD value
     */
    function decreaseAmoSupply(uint256 amount, address wallet) external onlyRole(AMO_DECREASE_ROLE) nonReentrant {
        // Validate inputs
        if (!_allowedAmoWallets.contains(wallet)) {
            revert UnsupportedAmoWallet(wallet);
        }

        // Convert dUSD amount to base value for debt token burning
        uint256 dstableBaseValue = dstableAmountToBaseValue(amount);
        uint256 debtAmount = baseToDebtUnits(dstableBaseValue);

        // Record initial supplies
        uint256 preDebtSupply = debtToken.totalSupply();
        uint256 preDstableSupply = dstable.totalSupply();

        // Pull dUSD from the AMO wallet to this manager (requires prior approval)
        IERC20Metadata(address(dstable)).safeTransferFrom(wallet, address(this), amount);

        // Burn dUSD from manager's own balance
        dstable.burn(amount);

        // Withdraw debt tokens from the vault to this manager and burn them
        CollateralVault(collateralVault).withdrawTo(address(this), debtAmount, address(debtToken));
        debtToken.burn(debtAmount);

        // Verify the supplies decreased correctly
        uint256 postDebtSupply = debtToken.totalSupply();
        uint256 postDstableSupply = dstable.totalSupply();

        // Invariant: debt token decrease must match dUSD decrease in base value terms
        uint256 actualDebtDecrease = preDebtSupply - postDebtSupply;
        uint256 actualDstableDecrease = preDstableSupply - postDstableSupply;
        uint256 expectedDebtFromDstable = baseToDebtUnits(dstableAmountToBaseValue(actualDstableDecrease));

        // Allow for minimal rounding difference
        if (
            actualDebtDecrease + tolerance < expectedDebtFromDstable ||
            actualDebtDecrease > expectedDebtFromDstable + tolerance
        ) {
            revert InvariantViolation(expectedDebtFromDstable, actualDebtDecrease);
        }
    }

    /* Collateral AMO Operations */

    /**
     * @notice Borrows collateral from vault to endpoint with invariant checks
     * @param wallet The AMO wallet to receive the borrowed collateral
     * @param asset The collateral asset to borrow
     * @param amount The amount of collateral to borrow
     * @dev Enforces value conservation: vault total value must remain unchanged within tolerance
     */
    function borrowTo(
        address wallet,
        address asset,
        uint256 amount,
        uint256 minDebtMinted
    ) external onlyRole(AMO_INCREASE_ROLE) nonReentrant {
        // Validate inputs
        if (!_allowedAmoWallets.contains(wallet)) {
            revert UnsupportedAmoWallet(wallet);
        }
        if (!CollateralVault(collateralVault).isCollateralSupported(asset)) {
            revert UnsupportedCollateral(asset);
        }
        if (asset == address(debtToken)) {
            revert DebtTokenProhibited();
        }

        // Record pre-operation vault value
        uint256 preValue = CollateralVault(collateralVault).totalValue();

        // Calculate debt amount to mint (equal to asset value)
        uint256 assetValue = CollateralVault(collateralVault).assetValueFromAmount(amount, asset);
        uint256 debtAmount = baseToDebtUnits(assetValue);

        // Slippage: ensure we mint at least the caller's minimum expected debt
        if (debtAmount < minDebtMinted) {
            revert SlippageDebtMintTooLow(debtAmount, minDebtMinted);
        }

        // Mint debt tokens to the vault
        debtToken.mintToVault(collateralVault, debtAmount);

        // Withdraw collateral to endpoint
        CollateralVault(collateralVault).withdrawTo(wallet, amount, asset);

        // Record post-operation vault value
        uint256 postValue = CollateralVault(collateralVault).totalValue();

        // Invariant (single-sided): vault must not lose more than tolerance
        if (postValue + tolerance < preValue) {
            revert InvariantViolation(preValue, postValue);
        }

        emit Borrowed(collateralVault, wallet, asset, amount, debtAmount);
    }

    /**
     * @notice Repays borrowed collateral from endpoint to vault with invariant checks
     * @param wallet The AMO wallet providing the collateral for repayment
     * @param asset The collateral asset being repaid
     * @param amount The amount of collateral to repay
     * @dev Enforces value conservation: vault total value must remain unchanged within tolerance
     */
    function repayFrom(
        address wallet,
        address asset,
        uint256 amount,
        uint256 maxDebtBurned
    ) public onlyRole(AMO_DECREASE_ROLE) nonReentrant {
        // Validate inputs
        if (!_allowedAmoWallets.contains(wallet)) {
            revert UnsupportedAmoWallet(wallet);
        }
        if (!CollateralVault(collateralVault).isCollateralSupported(asset)) {
            revert UnsupportedCollateral(asset);
        }
        if (asset == address(debtToken)) {
            revert DebtTokenProhibited();
        }

        // Record pre-operation vault value
        uint256 preValue = CollateralVault(collateralVault).totalValue();

        // Calculate debt amount to burn (equal to asset value)
        uint256 assetValue = CollateralVault(collateralVault).assetValueFromAmount(amount, asset);
        uint256 debtAmount = baseToDebtUnits(assetValue);

        // Slippage: ensure we do not burn more than caller's maximum
        if (debtAmount > maxDebtBurned) {
            revert SlippageDebtBurnTooHigh(debtAmount, maxDebtBurned);
        }

        // Transfer collateral from endpoint to vault
        IERC20Metadata(asset).safeTransferFrom(wallet, collateralVault, amount);

        // Withdraw debt tokens from the vault to this manager and burn them
        CollateralVault(collateralVault).withdrawTo(address(this), debtAmount, address(debtToken));
        debtToken.burn(debtAmount);

        // Record post-operation vault value
        uint256 postValue = CollateralVault(collateralVault).totalValue();

        // Invariant (single-sided): vault must not lose more than tolerance
        if (postValue + tolerance < preValue) {
            revert InvariantViolation(preValue, postValue);
        }

        emit Repaid(collateralVault, wallet, asset, amount, debtAmount);
    }

    /**
     * @notice Repay using EIP-2612 permit for collateral tokens that support it
     */
    function repayWithPermit(
        address wallet,
        address asset,
        uint256 amount,
        uint256 maxDebtBurned,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRole(AMO_DECREASE_ROLE) nonReentrant {
        IERC20Permit(asset).permit(wallet, address(this), amount, deadline, v, r, s);
        repayFrom(wallet, asset, amount, maxDebtBurned);
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

    /* Admin Functions */

    /**
     * @notice Sets the single accounting collateral vault
     * @param newVault The new collateral vault address
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function setCollateralVault(address newVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newVault == address(0)) {
            revert UnsupportedVault(newVault);
        }
        address oldVault = collateralVault;
        collateralVault = newVault;
        emit CollateralVaultSet(oldVault, newVault);
    }

    /**
     * @notice Sets AMO wallet allowed status
     * @param wallet The AMO wallet address
     * @param allowed Whether the wallet should be allowed
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function setAmoWalletAllowed(address wallet, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (allowed) {
            _allowedAmoWallets.add(wallet);
        } else {
            _allowedAmoWallets.remove(wallet);
        }
        emit AmoWalletAllowedSet(wallet, allowed);
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
     * @notice Returns all allowed AMO wallets
     * @return Array of allowed wallet addresses
     */
    function getAllowedAmoWallets() external view returns (address[] memory) {
        return _allowedAmoWallets.values();
    }

    /**
     * @notice Checks if an AMO wallet is allowed
     * @param wallet The wallet address to check
     * @return Whether the wallet is allowed
     */
    function isAmoWalletAllowed(address wallet) external view returns (bool) {
        return _allowedAmoWallets.contains(wallet);
    }

    /**
     * @notice Returns the number of allowed AMO wallets
     * @return The count of allowed wallets
     */
    function getAllowedAmoWalletsLength() external view returns (uint256) {
        return _allowedAmoWallets.length();
    }

    /**
     * @notice Returns total debt token supply for telemetry
     * @return The total supply of debt tokens
     */
    function totalDebtSupply() external view returns (uint256) {
        return debtToken.totalSupply();
    }
}
