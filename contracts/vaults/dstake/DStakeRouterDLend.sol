// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IDStakeRouter} from "./interfaces/IDStakeRouter.sol";
import {IDStableConversionAdapter} from "./interfaces/IDStableConversionAdapter.sol";
import {IDStakeCollateralVault} from "./DStakeCollateralVault.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/**
 * @title DStakeRouterDLend
 * @notice Orchestrates deposits, withdrawals, and asset exchanges for a DStakeToken vault.
 * @dev Interacts with the DStakeToken, DStakeCollateralVault, and various IDStableConversionAdapters.
 *      This contract is non-upgradeable but replaceable via DStakeToken governance.
 *      Relies on the associated DStakeToken for role management.
 */
contract DStakeRouterDLend is IDStakeRouter, AccessControl {
    using SafeERC20 for IERC20;

    // --- Errors ---
    error ZeroAddress();
    error AdapterNotFound(address vaultAsset);
    error ZeroPreviewWithdrawAmount(address vaultAsset);
    error InsufficientDStableFromAdapter(
        address vaultAsset,
        uint256 expected,
        uint256 actual
    );
    error VaultAssetManagedByDifferentAdapter(
        address vaultAsset,
        address existingAdapter
    );
    error ZeroInputDStableValue(address fromAsset, uint256 fromAmount);
    error AdapterAssetMismatch(
        address adapter,
        address expectedAsset,
        address actualAsset
    );
    error SlippageCheckFailed(
        address toAsset,
        uint256 calculatedAmount,
        uint256 minAmount
    );
    error InconsistentState(string message);

    // --- Roles ---
    bytes32 public constant DSTAKE_TOKEN_ROLE = keccak256("DSTAKE_TOKEN_ROLE");
    bytes32 public constant COLLATERAL_EXCHANGER_ROLE =
        keccak256("COLLATERAL_EXCHANGER_ROLE");

    // --- State ---
    address public immutable dStakeToken; // The DStakeToken this router serves
    IDStakeCollateralVault public immutable collateralVault; // The DStakeCollateralVault this router serves
    address public immutable dStable; // The underlying dSTABLE asset address

    mapping(address => address) public vaultAssetToAdapter; // vaultAsset => adapterAddress
    address public defaultDepositVaultAsset; // Default strategy for deposits

    // --- Constructor ---
    constructor(address _dStakeToken, address _collateralVault) {
        if (_dStakeToken == address(0) || _collateralVault == address(0)) {
            revert ZeroAddress();
        }
        dStakeToken = _dStakeToken;
        collateralVault = IDStakeCollateralVault(_collateralVault);
        dStable = collateralVault.dStable(); // Fetch dStable address from vault
        if (dStable == address(0)) {
            revert ZeroAddress();
        }

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DSTAKE_TOKEN_ROLE, _dStakeToken);
    }

    // --- External Functions (IDStakeRouter Interface) ---

    /**
     * @inheritdoc IDStakeRouter
     */
    function deposit(
        uint256 dStableAmount,
        address receiver
    ) external override onlyRole(DSTAKE_TOKEN_ROLE) {
        address adapterAddress = vaultAssetToAdapter[defaultDepositVaultAsset];
        if (adapterAddress == address(0)) {
            revert AdapterNotFound(defaultDepositVaultAsset);
        }

        // 1. Pull dStableAmount from DStakeToken (caller)
        IERC20(dStable).safeTransferFrom(
            msg.sender,
            address(this),
            dStableAmount
        );

        // 2. Approve adapter (set required allowance using standard approve)
        IERC20(dStable).approve(adapterAddress, dStableAmount);

        // 3. Call adapter to convert and deposit to vault
        (
            address vaultAsset,
            uint256 vaultAssetAmount
        ) = IDStableConversionAdapter(adapterAddress).convertToVaultAsset(
                dStableAmount
            );

        emit Deposited(vaultAsset, vaultAssetAmount, dStableAmount, receiver);
    }

    /**
     * @inheritdoc IDStakeRouter
     */
    function withdraw(
        uint256 dStableAmount,
        address receiver,
        address owner
    ) external override onlyRole(DSTAKE_TOKEN_ROLE) {
        address adapterAddress = vaultAssetToAdapter[defaultDepositVaultAsset];
        if (adapterAddress == address(0)) {
            revert AdapterNotFound(defaultDepositVaultAsset);
        }
        IDStableConversionAdapter adapter = IDStableConversionAdapter(
            adapterAddress
        );

        // 1. Determine vault asset and required amount
        address vaultAsset = adapter.vaultAsset();
        // Use previewConvertFromVaultAsset to get the required vaultAssetAmount for the target dStableAmount
        uint256 vaultAssetAmount = IERC4626(vaultAsset).previewWithdraw(
            dStableAmount
        );
        if (vaultAssetAmount == 0) revert ZeroPreviewWithdrawAmount(vaultAsset);

        // 2. Pull vaultAsset from collateral vault
        collateralVault.sendAsset(vaultAsset, vaultAssetAmount, address(this));

        // 3. Approve adapter (set required allowance using standard approve)
        IERC20(vaultAsset).approve(adapterAddress, vaultAssetAmount);

        // 4. Call adapter to convert and send dStable to receiver
        // Temporarily transfer to this contract, then forward to receiver if needed
        uint256 receivedDStable = adapter.convertFromVaultAsset(
            vaultAssetAmount
        );
        IERC20(dStable).safeTransfer(receiver, receivedDStable);

        // Sanity check: Ensure received amount is sufficient
        if (receivedDStable < dStableAmount) {
            revert InsufficientDStableFromAdapter(
                vaultAsset,
                dStableAmount,
                receivedDStable
            );
        }

        emit Withdrawn(
            vaultAsset,
            vaultAssetAmount,
            dStableAmount,
            owner,
            receiver
        );
    }

    // --- External Functions (Exchange/Rebalance) ---

    /**
     * @notice Exchanges `fromVaultAssetAmount` of one vault asset for another via their adapters.
     * @dev Uses dSTABLE as the intermediary asset. Requires COLLATERAL_EXCHANGER_ROLE.
     * @param fromVaultAsset The address of the asset to sell.
     * @param toVaultAsset The address of the asset to buy.
     * @param fromVaultAssetAmount The amount of the `fromVaultAsset` to exchange.
     * @param minToVaultAssetAmount The minimum amount of `toVaultAsset` the solver is willing to accept.
     */
    function exchangeAssetsUsingAdapters(
        address fromVaultAsset,
        address toVaultAsset,
        uint256 fromVaultAssetAmount,
        uint256 minToVaultAssetAmount
    ) external onlyRole(COLLATERAL_EXCHANGER_ROLE) {
        address fromAdapterAddress = vaultAssetToAdapter[fromVaultAsset];
        address toAdapterAddress = vaultAssetToAdapter[toVaultAsset];
        if (fromAdapterAddress == address(0))
            revert AdapterNotFound(fromVaultAsset);
        if (toAdapterAddress == address(0))
            revert AdapterNotFound(toVaultAsset);

        IDStableConversionAdapter fromAdapter = IDStableConversionAdapter(
            fromAdapterAddress
        );
        IDStableConversionAdapter toAdapter = IDStableConversionAdapter(
            toAdapterAddress
        );

        // 1. Get assets and calculate equivalent dStable amount
        uint256 dStableAmountEquivalent = fromAdapter
            .previewConvertFromVaultAsset(fromVaultAssetAmount);

        // 2. Pull fromVaultAsset from collateral vault
        collateralVault.sendAsset(
            fromVaultAsset,
            fromVaultAssetAmount,
            address(this)
        );

        // 3. Approve fromAdapter & Convert fromVaultAsset -> dStable (sent to this router)
        IERC20(fromVaultAsset).approve(
            fromAdapterAddress,
            fromVaultAssetAmount
        );
        uint256 receivedDStable = fromAdapter.convertFromVaultAsset(
            fromVaultAssetAmount
        );

        // 4. Approve toAdapter & Convert dStable -> toVaultAsset (sent to collateralVault)
        IERC20(dStable).approve(toAdapterAddress, receivedDStable);
        (
            address actualToVaultAsset,
            uint256 resultingToVaultAssetAmount
        ) = toAdapter.convertToVaultAsset(receivedDStable);
        require(actualToVaultAsset == toVaultAsset, "Adapter asset mismatch");
        // Slippage control: ensure output meets minimum requirement
        if (resultingToVaultAssetAmount < minToVaultAssetAmount) {
            revert SlippageCheckFailed(
                toVaultAsset,
                resultingToVaultAssetAmount,
                minToVaultAssetAmount
            );
        }

        emit Exchanged(
            fromVaultAsset,
            toVaultAsset,
            fromVaultAssetAmount,
            resultingToVaultAssetAmount,
            dStableAmountEquivalent,
            msg.sender
        );
    }

    /**
     * @notice Exchanges assets between the collateral vault and an external solver.
     * @dev Pulls `fromVaultAsset` from the solver (`msg.sender`) and sends `toVaultAsset` from the vault to the solver.
     *      Requires COLLATERAL_EXCHANGER_ROLE.
     * @param fromVaultAsset The address of the asset the solver is providing.
     * @param toVaultAsset The address of the asset the solver will receive from the vault.
     * @param fromVaultAssetAmount The amount of `fromVaultAsset` provided by the solver.
     * @param minToVaultAssetAmount The minimum amount of `toVaultAsset` the solver is willing to accept.
     */
    function exchangeAssets(
        address fromVaultAsset,
        address toVaultAsset,
        uint256 fromVaultAssetAmount,
        uint256 minToVaultAssetAmount
    ) external onlyRole(COLLATERAL_EXCHANGER_ROLE) {
        if (fromVaultAssetAmount == 0) {
            revert InconsistentState("Input amount cannot be zero");
        }
        if (fromVaultAsset == address(0) || toVaultAsset == address(0)) {
            revert ZeroAddress();
        }

        address fromAdapterAddress = vaultAssetToAdapter[fromVaultAsset];
        address toAdapterAddress = vaultAssetToAdapter[toVaultAsset];
        if (fromAdapterAddress == address(0))
            revert AdapterNotFound(fromVaultAsset);
        if (toAdapterAddress == address(0))
            revert AdapterNotFound(toVaultAsset);

        IDStableConversionAdapter fromAdapter = IDStableConversionAdapter(
            fromAdapterAddress
        );
        IDStableConversionAdapter toAdapter = IDStableConversionAdapter(
            toAdapterAddress
        );

        // Calculate the dStable value received from the solver's input asset
        uint256 dStableValueIn = fromAdapter.previewConvertFromVaultAsset(
            fromVaultAssetAmount
        );
        if (dStableValueIn == 0)
            revert ZeroInputDStableValue(fromVaultAsset, fromVaultAssetAmount);

        // Calculate the expected output vault asset amount based on the dStable value received
        (
            address expectedToAsset,
            uint256 calculatedToVaultAssetAmount
        ) = toAdapter.previewConvertToVaultAsset(dStableValueIn);

        // Sanity check: ensure the adapter is for the correct target asset
        if (expectedToAsset != toVaultAsset) {
            revert AdapterAssetMismatch(
                toAdapterAddress,
                toVaultAsset,
                expectedToAsset
            );
        }

        // Slippage check: ensure calculated output meets minimum requirement
        if (calculatedToVaultAssetAmount < minToVaultAssetAmount) {
            revert SlippageCheckFailed(
                toVaultAsset,
                calculatedToVaultAssetAmount,
                minToVaultAssetAmount
            );
        }
        // --- End Value Calculation and Slippage Check ---

        // 1. Pull fromVaultAsset from solver (msg.sender) to this contract
        IERC20(fromVaultAsset).safeTransferFrom(
            msg.sender,
            address(this),
            fromVaultAssetAmount
        );

        // 2. Deposit fromVaultAsset into the collateralVault
        // Directly transfer the asset to the vault
        IERC20(fromVaultAsset).safeTransfer(
            address(collateralVault),
            fromVaultAssetAmount
        );

        // 3. Send toVaultAsset from collateralVault to solver (msg.sender)
        // Use the calculated amount that met the slippage check
        collateralVault.sendAsset(
            toVaultAsset,
            calculatedToVaultAssetAmount,
            msg.sender
        );

        emit Exchanged(
            fromVaultAsset,
            toVaultAsset,
            fromVaultAssetAmount,
            calculatedToVaultAssetAmount,
            dStableValueIn,
            msg.sender
        );
    }

    // --- External Functions (Governance - Managed by Admin) ---

    /**
     * @notice Adds or updates a conversion adapter for a given vault asset.
     * @dev Only callable by an address with DEFAULT_ADMIN_ROLE.
     * @param vaultAsset The address of the vault asset.
     * @param adapterAddress The address of the new adapter contract.
     */
    function addAdapter(
        address vaultAsset,
        address adapterAddress
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapterAddress == address(0) || vaultAsset == address(0)) {
            revert ZeroAddress();
        }
        address adapterVaultAsset = IDStableConversionAdapter(adapterAddress)
            .vaultAsset();
        if (adapterVaultAsset != vaultAsset)
            revert AdapterAssetMismatch(
                adapterAddress,
                vaultAsset,
                adapterVaultAsset
            );
        if (
            vaultAssetToAdapter[vaultAsset] != address(0) &&
            vaultAssetToAdapter[vaultAsset] != adapterAddress
        ) {
            revert VaultAssetManagedByDifferentAdapter(
                vaultAsset,
                vaultAssetToAdapter[vaultAsset]
            );
        }
        vaultAssetToAdapter[vaultAsset] = adapterAddress;
        emit AdapterSet(vaultAsset, adapterAddress);
    }

    /**
     * @notice Removes a conversion adapter for a given vault asset.
     * @dev Only callable by an address with DEFAULT_ADMIN_ROLE.
     * @dev Does not automatically migrate funds. Ensure assets managed by this adapter are zero
     *      in the collateral vault or migrated via exchangeAssets before calling.
     * @param vaultAsset The address of the vault asset to remove.
     */
    function removeAdapter(
        address vaultAsset
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address adapterAddress = vaultAssetToAdapter[vaultAsset];
        if (adapterAddress == address(0)) {
            revert AdapterNotFound(vaultAsset);
        }
        delete vaultAssetToAdapter[vaultAsset];
        emit AdapterRemoved(vaultAsset, adapterAddress);
    }

    /**
     * @notice Sets the default vault asset to use for new deposits.
     * @dev Only callable by an address with DEFAULT_ADMIN_ROLE.
     * @param vaultAsset The address of the vault asset to set as default.
     */
    function setDefaultDepositVaultAsset(
        address vaultAsset
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vaultAssetToAdapter[vaultAsset] == address(0)) {
            revert AdapterNotFound(vaultAsset);
        }
        defaultDepositVaultAsset = vaultAsset;
        emit DefaultDepositVaultAssetSet(vaultAsset);
    }

    // --- Events ---
    event Deposited(
        address indexed vaultAsset,
        uint256 vaultAssetAmount,
        uint256 dStableAmount,
        address receiver
    );
    event Withdrawn(
        address indexed vaultAsset,
        uint256 vaultAssetAmount,
        uint256 dStableAmount,
        address owner,
        address receiver
    );
    event Exchanged(
        address indexed fromAsset,
        address indexed toAsset,
        uint256 fromAssetAmount,
        uint256 toAssetAmount,
        uint256 dStableAmountEquivalent,
        address indexed exchanger
    );
    event AdapterSet(address indexed vaultAsset, address adapterAddress);
    event AdapterRemoved(address indexed vaultAsset, address adapterAddress);
    event DefaultDepositVaultAssetSet(address indexed vaultAsset);
}
