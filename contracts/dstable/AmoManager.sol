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
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "contracts/common/IMintableERC20.sol";
import "./CollateralVault.sol";
import "./OracleAware.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Forward declaration interface for AmoVault instead of importing the full contract
interface IAmoVault {
    function totalValue() external view returns (uint256);

    function totalDstableValue() external view returns (uint256);

    function totalCollateralValue() external view returns (uint256);

    function withdrawTo(address recipient, uint256 amount, address asset) external;

    function assetValueFromAmount(uint256 amount, address asset) external view returns (uint256);
}

/**
 * @title AmoManager
 * @dev Manages AMOs for dStable
 * Handles allocation, deallocation, collateral management, and profit management for AMO vaults.
 */
contract AmoManager is AccessControl, OracleAware, ReentrancyGuard {
    using EnumerableMap for EnumerableMap.AddressToUintMap;

    /* Core state */

    EnumerableMap.AddressToUintMap private _amoVaults;
    // Separate map to track whether a vault is considered active. This decouples
    // allocation bookkeeping (which may change when moving collateral) from the
    // governance‐controlled active status of a vault.
    mapping(address => bool) private _isAmoActive;
    uint256 public totalAllocated;
    IMintableERC20 public dstable;
    CollateralVault public collateralHolderVault;

    /* Events */

    event AmoVaultSet(address indexed amoVault, bool isActive);
    event AmoAllocated(address indexed amoVault, uint256 dstableAmount);
    event AmoDeallocated(address indexed amoVault, uint256 dstableAmount);
    event ProfitsWithdrawn(address indexed amoVault, uint256 amount);
    event AllocationSurplus(address indexed amoVault, uint256 surplusInDstable);

    /* Roles */

    bytes32 public constant AMO_ALLOCATOR_ROLE = keccak256("AMO_ALLOCATOR_ROLE");
    bytes32 public constant FEE_COLLECTOR_ROLE = keccak256("FEE_COLLECTOR_ROLE");

    /* Errors */

    error InactiveAmoVault(address amoVault);
    error AmoSupplyInvariantViolation(uint256 startingSupply, uint256 endingSupply);
    error AmoVaultAlreadyEnabled(address amoVault);
    error CannotTransferDStable();
    error InsufficientProfits(uint256 takeProfitValueInBase, int256 availableProfitInBase);
    error InsufficientAllocation(uint256 requested, uint256 available);

    /**
     * @notice Initializes the AmoManager contract.
     * @param _dstable The address of the dStable stablecoin.
     * @param _collateralHolderVault The address of the collateral holder vault.
     * @param _oracle The oracle for price feeds.
     */
    constructor(
        address _dstable,
        address _collateralHolderVault,
        IPriceOracleGetter _oracle
    ) OracleAware(_oracle, _oracle.BASE_CURRENCY_UNIT()) {
        dstable = IMintableERC20(_dstable);
        collateralHolderVault = CollateralVault(_collateralHolderVault);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        grantRole(AMO_ALLOCATOR_ROLE, msg.sender);
        grantRole(FEE_COLLECTOR_ROLE, msg.sender);
    }

    /* AMO */

    /**
     * @notice Allocates AMO tokens to an AMO vault.
     * @param amoVault The address of the AMO vault.
     * @param dstableAmount The amount of dStable to allocate.
     */
    function allocateAmo(address amoVault, uint256 dstableAmount) public onlyRole(AMO_ALLOCATOR_ROLE) nonReentrant {
        uint256 startingAmoSupply = totalAmoSupply();

        // Make sure the vault is active
        if (!isAmoActive(amoVault)) {
            revert InactiveAmoVault(amoVault);
        }

        // Update the allocation for this vault
        (, uint256 currentAllocation) = _amoVaults.tryGet(amoVault);
        _amoVaults.set(amoVault, currentAllocation + dstableAmount);

        // Make the deposit
        totalAllocated += dstableAmount;
        dstable.transfer(amoVault, dstableAmount);

        // Check invariants
        uint256 endingAmoSupply = totalAmoSupply();
        if (endingAmoSupply != startingAmoSupply) {
            revert AmoSupplyInvariantViolation(startingAmoSupply, endingAmoSupply);
        }

        emit AmoAllocated(amoVault, dstableAmount);
    }

    /**
     * @notice Deallocates AMO tokens from an AMO vault.
     * @param amoVault The address of the AMO vault.
     * @param dstableAmount The amount of dStable to deallocate.
     */
    function deallocateAmo(address amoVault, uint256 dstableAmount) public onlyRole(AMO_ALLOCATOR_ROLE) nonReentrant {
        uint256 startingAmoSupply = totalAmoSupply();

        // We don't require that the vault is active or has allocation, since we want to allow withdrawing from inactive vaults

        // If the vault is still active, make sure it has enough allocation and decrease it
        (, uint256 currentAllocation) = _amoVaults.tryGet(amoVault);

        // Ensure we do not deallocate more than the vault's recorded allocation
        if (dstableAmount > currentAllocation) {
            revert InsufficientAllocation(dstableAmount, currentAllocation);
        }

        // Update the allocation for this vault (safe: dstableAmount <= currentAllocation)
        _amoVaults.set(amoVault, currentAllocation - dstableAmount);

        // Make the withdrawal and update global counter
        totalAllocated -= dstableAmount;
        dstable.transferFrom(amoVault, address(this), dstableAmount);

        // Check invariants
        uint256 endingAmoSupply = totalAmoSupply();
        if (endingAmoSupply != startingAmoSupply) {
            revert AmoSupplyInvariantViolation(startingAmoSupply, endingAmoSupply);
        }

        emit AmoDeallocated(amoVault, dstableAmount);
    }

    /**
     * @notice Returns the total AMO supply.
     * @return The total AMO supply.
     */
    function totalAmoSupply() public view returns (uint256) {
        uint256 freeBalance = dstable.balanceOf(address(this));
        return freeBalance + totalAllocated;
    }

    /**
     * @notice Decreases the AMO supply by burning dStable.
     * @param dstableAmount The amount of dStable to burn.
     */
    function decreaseAmoSupply(uint256 dstableAmount) public onlyRole(AMO_ALLOCATOR_ROLE) {
        dstable.burn(dstableAmount);
    }

    /**
     * @notice Checks if an AMO vault is active.
     * @param amoVault The address of the AMO vault to check.
     * @return True if the AMO vault is active, false otherwise.
     */
    function isAmoActive(address amoVault) public view returns (bool) {
        return _isAmoActive[amoVault];
    }

    /**
     * @notice Returns the allocation for a specific AMO vault.
     * @param amoVault The address of the AMO vault.
     * @return The current allocation for the vault.
     */
    function amoVaultAllocation(address amoVault) public view returns (uint256) {
        (bool exists, uint256 allocation) = _amoVaults.tryGet(amoVault);
        return exists ? allocation : 0;
    }

    /**
     * @notice Returns the list of all AMO vaults.
     * @return The list of AMO vault addresses.
     */
    function amoVaults() public view returns (address[] memory) {
        return _amoVaults.keys();
    }

    /**
     * @notice Enables an AMO vault.
     * @param amoVault The address of the AMO vault.
     */
    function enableAmoVault(address amoVault) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_isAmoActive[amoVault]) {
            revert AmoVaultAlreadyEnabled(amoVault);
        }
        // Ensure the vault is tracked in the allocation map (initial allocation may be zero)
        (, uint256 currentAllocation) = _amoVaults.tryGet(amoVault);
        _amoVaults.set(amoVault, currentAllocation);
        _isAmoActive[amoVault] = true;
        emit AmoVaultSet(amoVault, true);
    }

    /**
     * @notice Disables an AMO vault.
     * @param amoVault The address of the AMO vault.
     */
    function disableAmoVault(address amoVault) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_isAmoActive[amoVault]) {
            revert InactiveAmoVault(amoVault);
        }
        _isAmoActive[amoVault] = false;
        emit AmoVaultSet(amoVault, false);
    }

    /* Collateral Management */

    /**
     * @notice Returns the total collateral value of all active AMO vaults.
     * @return The total collateral value in base value.
     */
    function totalCollateralValue() public view returns (uint256) {
        uint256 totalBaseValue = 0;
        for (uint256 i = 0; i < _amoVaults.length(); i++) {
            (address vaultAddress, ) = _amoVaults.at(i);
            if (isAmoActive(vaultAddress)) {
                totalBaseValue += IAmoVault(vaultAddress).totalCollateralValue();
            }
        }
        return totalBaseValue;
    }

    /**
     * @notice Transfers collateral from an AMO vault to the holding vault.
     * @param amoVault The address of the AMO vault.
     * @param token The address of the collateral token to transfer.
     * @param amount The amount of collateral to transfer.
     */
    function transferFromAmoVaultToHoldingVault(
        address amoVault,
        address token,
        uint256 amount
    ) public onlyRole(AMO_ALLOCATOR_ROLE) nonReentrant {
        if (token == address(dstable)) {
            revert CannotTransferDStable();
        }

        // Update allocation
        // A note on why we modify AMO allocation when we withdraw collateral:
        // 1. When dStable AMO enters the AMO vault, the dStable is initially unbacked
        // 2. Over time the AMO vault accrues collateral in exchange for distributing dStable
        // 3. We may be able to make better use of that collateral in a different collateral vault
        // 4. So we transfer the collateral out of the AMO vault, but at that point the dStable that
        //    converted to that collateral is now free-floating and fully backed
        // 5. Thus we decrement the AMO allocation to reflect the fact that the dStable is no longer
        //    unbacked, but is actually fully backed and circulating
        uint256 collateralBaseValue = collateralHolderVault.assetValueFromAmount(amount, token);
        uint256 collateralInDstable = baseValueToDstableAmount(collateralBaseValue);
        (, uint256 currentAllocation) = _amoVaults.tryGet(amoVault);

        uint256 adjustmentAmount = collateralInDstable;
        if (collateralInDstable > currentAllocation) {
            // Emit event to explicitly record the surplus that improves backing
            uint256 surplus = collateralInDstable - currentAllocation;
            emit AllocationSurplus(amoVault, surplus);

            // Cap the adjustment to the current allocation to prevent underflow
            adjustmentAmount = currentAllocation;
        }

        // Bookkeeping: adjust the vault's allocation. This does NOT change the vault's active status.
        _amoVaults.set(amoVault, currentAllocation - adjustmentAmount);
        totalAllocated -= adjustmentAmount;

        // Transfer the collateral
        IAmoVault(amoVault).withdrawTo(address(collateralHolderVault), amount, token);
    }

    /**
     * @notice Transfers collateral from the holding vault to an AMO vault.
     * @param amoVault The address of the AMO vault.
     * @param token The address of the collateral token to transfer.
     * @param amount The amount of collateral to transfer.
     */
    function transferFromHoldingVaultToAmoVault(
        address amoVault,
        address token,
        uint256 amount
    ) public onlyRole(AMO_ALLOCATOR_ROLE) nonReentrant {
        if (token == address(dstable)) {
            revert CannotTransferDStable();
        }
        if (!_isAmoActive[amoVault]) {
            revert InactiveAmoVault(amoVault);
        }

        // Update allocation
        // A note on why we modify AMO allocation when we deposit collateral:
        // 1. When we deposit collateral, it can be used to buy back dStable
        // 2. When we buy back dStable, the dStable is now unbacked (a redemption)
        // 3. Thus any collateral deposited to an AMO vault can create unbacked dStable,
        //    which means the AMO allocation for that vault must be increased to reflect this
        uint256 collateralBaseValue = collateralHolderVault.assetValueFromAmount(amount, token);
        uint256 collateralInDstable = baseValueToDstableAmount(collateralBaseValue);
        (, uint256 currentAllocation) = _amoVaults.tryGet(amoVault);
        _amoVaults.set(amoVault, currentAllocation + collateralInDstable);
        totalAllocated += collateralInDstable;

        // Transfer the collateral
        collateralHolderVault.withdrawTo(amoVault, amount, token);
    }

    /* Profit Management */

    /**
     * @notice Returns the available profit for a specific vault in base value (e.g., the underlying).
     * @param vaultAddress The address of the AMO vault to check.
     * @return The available profit in base (can be negative).
     */
    function availableVaultProfitsInBase(address vaultAddress) public view returns (int256) {
        uint256 totalVaultValueInBase = IAmoVault(vaultAddress).totalValue();
        uint256 allocatedDstable = amoVaultAllocation(vaultAddress);
        uint256 allocatedValueInBase = dstableAmountToBaseValue(allocatedDstable);

        return int256(totalVaultValueInBase) - int256(allocatedValueInBase);
    }

    /**
     * @notice Withdraws profits from an AMO vault to a recipient.
     * @param amoVault The AMO vault from which to withdraw profits.
     * @param recipient The address to receive the profits.
     * @param takeProfitToken The collateral token to withdraw.
     * @param takeProfitAmount The amount of collateral to withdraw.
     * @return takeProfitValueInBase The value of the withdrawn profits in base.
     */
    function withdrawProfits(
        IAmoVault amoVault,
        address recipient,
        address takeProfitToken,
        uint256 takeProfitAmount
    ) public onlyRole(FEE_COLLECTOR_ROLE) nonReentrant returns (uint256 takeProfitValueInBase) {
        // Leave open the possibility of withdrawing profits from inactive vaults

        takeProfitValueInBase = amoVault.assetValueFromAmount(takeProfitAmount, takeProfitToken);

        int256 _availableProfitInBase = availableVaultProfitsInBase(address(amoVault));

        // Make sure we are withdrawing less than the available profit
        //
        // TECHNICAL NOTE:
        // `takeProfitValueInBase` is a `uint256` while `_availableProfitInBase` is an `int256`.
        // The explicit cast below will wrap if `takeProfitValueInBase` exceeds
        // `type(int256).max` (≈ 5.8e76), causing the comparison to evaluate to `false`.
        // Such a value is unachievable on-chain and the function is restricted to the
        // trusted `FEE_COLLECTOR_ROLE`, so the edge-case is not considered a practical
        // risk.
        if (_availableProfitInBase <= 0 || int256(takeProfitValueInBase) > _availableProfitInBase) {
            revert InsufficientProfits(takeProfitValueInBase, _availableProfitInBase);
        }

        // Withdraw profits from the vault
        amoVault.withdrawTo(recipient, takeProfitAmount, takeProfitToken);

        emit ProfitsWithdrawn(address(amoVault), takeProfitValueInBase);

        return takeProfitValueInBase;
    }

    /**
     * @notice Returns the total available profit across all AMO vaults in base.
     * @return The total available profit in base.
     */
    function availableProfitInBase() public view returns (int256) {
        int256 totalProfit = 0;

        // Iterate through all AMO vaults
        for (uint256 i = 0; i < _amoVaults.length(); i++) {
            (address vaultAddress, ) = _amoVaults.at(i);

            if (isAmoActive(vaultAddress)) {
                totalProfit += availableVaultProfitsInBase(vaultAddress);
            }
        }

        return totalProfit;
    }

    /* Utility */

    /**
     * @notice Converts a base value to an equivalent amount of dStable tokens.
     * @param baseValue The amount of base value to convert.
     * @return The equivalent amount of dStable tokens.
     */
    function baseValueToDstableAmount(uint256 baseValue) public view returns (uint256) {
        uint8 dstableDecimals = dstable.decimals();
        // Align valuation with Issuer/Redeemer: assume 1 dStable == baseCurrencyUnit
        return Math.mulDiv(baseValue, 10 ** dstableDecimals, baseCurrencyUnit);
    }

    /**
     * @notice Converts an amount of dStable tokens to an equivalent base value.
     * @param dstableAmount The amount of dStable tokens to convert.
     * @return The equivalent amount of base value.
     */
    function dstableAmountToBaseValue(uint256 dstableAmount) public view returns (uint256) {
        uint8 dstableDecimals = dstable.decimals();
        // Align valuation with Issuer/Redeemer: assume 1 dStable == baseCurrencyUnit
        return Math.mulDiv(dstableAmount, baseCurrencyUnit, 10 ** dstableDecimals);
    }

    /* Admin */

    /**
     * @notice Sets the collateral vault address
     * @param _collateralVault The address of the new collateral vault
     */
    function setCollateralVault(address _collateralVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        collateralHolderVault = CollateralVault(_collateralVault);
    }
}

/**
 * @title ICollateralSum
 * @dev Interface for contracts that can provide total collateral value.
 */
interface ICollateralSum {
    /**
     * @notice Returns the total collateral value of the implementing contract.
     * @return The total collateral value in base value.
     */
    function totalCollateralValue() external view returns (uint256);
}
