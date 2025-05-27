// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC4626, ERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDPoolCollateralVault} from "./interfaces/IDPoolCollateralVault.sol";
import {IDPoolRouter} from "./interfaces/IDPoolRouter.sol";
import {BasisPointConstants} from "../../common/BasisPointConstants.sol";

/**
 * @title DPoolToken
 * @notice ERC4626-compliant vault token representing shares in diversified LP positions
 * @dev Minimal, immutable ERC4626 implementation handling share accounting relative to LP token values
 *      Delegates complex operations to router and collateral vault contracts
 */
contract DPoolToken is ERC4626, AccessControl {
    // --- Roles ---
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    // --- Errors ---
    error ZeroAddress();
    error InvalidFeeBps(uint256 feeBps, uint256 maxFeeBps);
    error RouterOrVaultNotSet();

    // --- State ---
    IDPoolCollateralVault public collateralVault;
    IDPoolRouter public router;

    uint256 public withdrawalFeeBps;
    uint256 public immutable maxWithdrawalFeeBps;

    // --- Events ---
    event RouterSet(address indexed oldRouter, address indexed newRouter);
    event CollateralVaultSet(
        address indexed oldVault,
        address indexed newVault
    );
    event WithdrawalFeeSet(uint256 oldFeeBps, uint256 newFeeBps);
    event WithdrawalFee(
        address indexed owner,
        address indexed receiver,
        uint256 feeAmount
    );

    // --- Constructor ---
    constructor(
        string memory _name,
        string memory _symbol,
        IERC20 _baseAsset,
        address _initialAdmin,
        address _initialFeeManager,
        uint256 _maxWithdrawalFeeBps
    ) ERC20(_name, _symbol) ERC4626(_baseAsset) {
        if (
            address(_baseAsset) == address(0) ||
            _initialAdmin == address(0) ||
            _initialFeeManager == address(0)
        ) {
            revert ZeroAddress();
        }

        if (_maxWithdrawalFeeBps > BasisPointConstants.ONE_PERCENT_BPS) {
            revert InvalidFeeBps(
                _maxWithdrawalFeeBps,
                BasisPointConstants.ONE_PERCENT_BPS
            );
        }

        maxWithdrawalFeeBps = _maxWithdrawalFeeBps;

        _grantRole(DEFAULT_ADMIN_ROLE, _initialAdmin);
        _grantRole(FEE_MANAGER_ROLE, _initialFeeManager);
    }

    // --- ERC4626 Overrides ---

    /**
     * @inheritdoc ERC4626
     * @notice Returns the total amount of the base asset managed by this vault
     * @dev Delegates call to the collateralVault to get the total value of managed LP tokens
     */
    function totalAssets() public view virtual override returns (uint256) {
        if (address(collateralVault) == address(0)) {
            return 0;
        }
        return collateralVault.getTotalAssetValue();
    }

    /**
     * @inheritdoc ERC4626
     * @notice Handles deposit workflow with delegation to router
     * @dev Pulls base asset from depositor, then delegates conversion logic to router
     */
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        if (
            address(router) == address(0) ||
            address(collateralVault) == address(0)
        ) {
            revert RouterOrVaultNotSet();
        }

        // Transfer assets from caller to this contract
        IERC20(asset()).transferFrom(caller, address(this), assets);

        // Approve router to spend the received assets
        IERC20(asset()).approve(address(router), assets);

        // Delegate conversion and vault deposit logic to router
        // Router will convert base asset to LP tokens and send to collateral vault
        router.deposit(assets, receiver, 0); // TODO: Add slippage protection parameter

        // Mint shares to receiver
        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    /**
     * @inheritdoc ERC4626
     * @notice Handles withdrawal workflow with fee calculation and delegation to router
     * @dev Calculates withdrawal fee, then delegates conversion logic to router
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        if (
            address(router) == address(0) ||
            address(collateralVault) == address(0)
        ) {
            revert RouterOrVaultNotSet();
        }

        // Calculate withdrawal fee
        uint256 fee = (assets * withdrawalFeeBps) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        uint256 amountToSend = assets - fee;

        // Burn shares from owner
        _burn(owner, shares);

        // Delegate conversion and withdrawal logic to router
        // Router will pull LP tokens from vault, convert to base asset, and send to receiver
        router.withdraw(amountToSend, receiver, owner, 50_000); // TODO: Make maxSlippage configurable (5% in new BPS scale)

        emit Withdraw(caller, receiver, owner, assets, shares);

        // Emit fee event if fee was charged
        if (fee > 0) {
            emit WithdrawalFee(owner, receiver, fee);
        }
    }

    /**
     * @inheritdoc ERC4626
     * @notice Preview withdraw including withdrawal fee
     */
    function previewWithdraw(
        uint256 assets
    ) public view virtual override returns (uint256) {
        uint256 fee = (assets * withdrawalFeeBps) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        return super.previewWithdraw(assets + fee);
    }

    /**
     * @inheritdoc ERC4626
     * @notice Preview redeem including withdrawal fee
     */
    function previewRedeem(
        uint256 shares
    ) public view virtual override returns (uint256) {
        uint256 assets = super.previewRedeem(shares);
        uint256 fee = (assets * withdrawalFeeBps) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        return assets - fee;
    }

    // --- Governance Functions ---

    /**
     * @notice Sets the address of the DPoolRouter contract
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @param _router The address of the new router contract
     */
    function setRouter(address _router) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_router == address(0)) {
            revert ZeroAddress();
        }
        address oldRouter = address(router);
        router = IDPoolRouter(_router);
        emit RouterSet(oldRouter, _router);
    }

    /**
     * @notice Sets the address of the DPoolCollateralVault contract
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @param _collateralVault The address of the new collateral vault contract
     */
    function setCollateralVault(
        address _collateralVault
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_collateralVault == address(0)) {
            revert ZeroAddress();
        }
        address oldVault = address(collateralVault);
        collateralVault = IDPoolCollateralVault(_collateralVault);
        emit CollateralVaultSet(oldVault, _collateralVault);
    }

    /**
     * @notice Sets the withdrawal fee in basis points
     * @dev Only callable by FEE_MANAGER_ROLE
     * @param _feeBps The new withdrawal fee (e.g., 10 = 0.1%)
     */
    function setWithdrawalFeeBps(
        uint256 _feeBps
    ) external onlyRole(FEE_MANAGER_ROLE) {
        if (_feeBps > maxWithdrawalFeeBps) {
            revert InvalidFeeBps(_feeBps, maxWithdrawalFeeBps);
        }
        uint256 oldFeeBps = withdrawalFeeBps;
        withdrawalFeeBps = _feeBps;
        emit WithdrawalFeeSet(oldFeeBps, _feeBps);
    }

    // --- View Functions ---

    /**
     * @notice Returns the base asset address (same as asset() but more descriptive)
     * @return baseAsset Address of the base asset
     */
    function baseAsset() external view returns (address) {
        return asset();
    }
}
