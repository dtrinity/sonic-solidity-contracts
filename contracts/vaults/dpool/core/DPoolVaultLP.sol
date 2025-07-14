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

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/IDPoolVaultLP.sol";
import "../../../common/BasisPointConstants.sol";
import "../../../common/SupportsWithdrawalFee.sol";

/**
 * @title DPoolVaultLP
 * @author dTRINITY Protocol
 * @notice Abstract base ERC4626 vault that accepts LP tokens as the primary asset
 * @dev Each vault represents a specific LP position on a specific DEX. The vault's asset() is the LP token itself.
 */
abstract contract DPoolVaultLP is
    ERC4626,
    AccessControl,
    ReentrancyGuard,
    IDPoolVaultLP,
    SupportsWithdrawalFee
{
    using SafeERC20 for IERC20;

    // --- Constants ---

    /// @notice Role identifier for fee management
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    /// @notice Maximum withdrawal fee (5%)
    uint256 public constant MAX_WITHDRAWAL_FEE_BPS_CONFIG =
        5 * BasisPointConstants.ONE_PERCENT_BPS;

    // --- Immutables ---

    /// @notice Address of the LP token this vault accepts (same as asset())
    address public immutable LP_TOKEN;

    // --- State variables ---
    // `withdrawalFeeBps_` (internal) is inherited from SupportsWithdrawalFee.sol

    // --- Errors ---
    // ZeroAddress and InsufficientLPTokens are inherited from IDPoolVaultLP interface
    // FeeExceedsMaxFee and InitialFeeExceedsMaxFee are inherited from SupportsWithdrawalFee
    error ZeroShares();

    // --- Constructor ---

    /**
     * @notice Initialize the vault
     * @param _lpToken Address of the LP token this vault accepts (becomes the ERC4626 asset)
     * @param name Vault token name
     * @param symbol Vault token symbol
     * @param admin Address to grant admin role
     */
    constructor(
        address _lpToken,
        string memory name,
        string memory symbol,
        address admin
    ) ERC4626(IERC20(_lpToken)) ERC20(name, symbol) {
        if (_lpToken == address(0)) revert ZeroAddress();
        if (admin == address(0)) revert ZeroAddress();

        LP_TOKEN = _lpToken;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEE_MANAGER_ROLE, admin);
        _initializeWithdrawalFee(0); // Initialize fee to 0 via SupportsWithdrawalFee
    }

    // --- SupportsWithdrawalFee Implementation ---
    function _maxWithdrawalFeeBps()
        internal
        view
        virtual
        override
        returns (uint256)
    {
        return MAX_WITHDRAWAL_FEE_BPS_CONFIG;
    }

    /**
     * @notice Public getter for the current withdrawal fee in basis points.
     * @dev Satisfies IDPoolVaultLP interface and provides public access to the fee.
     */
    function withdrawalFeeBps() external view override returns (uint256) {
        return getWithdrawalFeeBps(); // Uses public getter from SupportsWithdrawalFee
    }

    // --- View functions ---

    /// @inheritdoc IDPoolVaultLP
    function lpToken() external view override returns (address) {
        return LP_TOKEN;
    }

    /// @inheritdoc IDPoolVaultLP
    // This function provides the configured max fee, mirroring the constant.
    function maxWithdrawalFeeBps() external pure override returns (uint256) {
        return MAX_WITHDRAWAL_FEE_BPS_CONFIG;
    }

    // --- Abstract functions ---

    /**
     * @notice Get the DEX pool address - must be implemented by each DEX-specific vault
     * @return Address of the DEX pool
     */
    function pool() external view virtual override returns (address);

    /**
     * @notice Preview base asset value for LP tokens - must be implemented by each DEX-specific vault
     * @dev This is an auxiliary function for external valuation, not used in core ERC4626 mechanics
     * @param lpAmount Amount of LP tokens
     * @return Base asset value
     */
    function previewLPValue(
        uint256 lpAmount
    ) external view virtual override returns (uint256);

    /// @inheritdoc IDPoolVaultLP
    function previewDepositLP(
        uint256 lpAmount
    ) external view override returns (uint256 shares) {
        return previewDeposit(lpAmount);
    }

    // --- ERC4626 Overrides for Fee Integration ---

    /**
     * @inheritdoc ERC4626
     * @dev Preview withdraw including withdrawal fee.
     *      The `assets` parameter is the net amount of LP tokens the user wants to receive.
     */
    function previewWithdraw(
        uint256 assets
    ) public view virtual override(ERC4626, IERC4626) returns (uint256 shares) {
        uint256 grossAssetsRequired = _getGrossAmountRequiredForNet(assets);
        return super.previewWithdraw(grossAssetsRequired);
    }

    /**
     * @inheritdoc ERC4626
     * @dev Preview redeem including withdrawal fee.
     *      Calculates gross assets from shares, then deducts fee to show net assets user receives.
     */
    function previewRedeem(
        uint256 shares
    ) public view virtual override(ERC4626, IERC4626) returns (uint256 assets) {
        uint256 grossAssets = super.previewRedeem(shares);
        return _getNetAmountAfterFee(grossAssets);
    }

    // --- Deposit/withdrawal logic ---

    /**
     * @dev Override to handle LP token deposits
     * @param lpAmount Amount of LP tokens to deposit
     * @param receiver Address to receive vault shares
     * @return shares_ Amount of shares minted
     */
    function deposit(
        uint256 lpAmount,
        address receiver
    )
        public
        virtual
        override(ERC4626, IERC4626)
        nonReentrant
        returns (uint256 shares_)
    {
        require(
            lpAmount <= maxDeposit(receiver),
            "ERC4626: deposit more than max"
        );

        shares_ = previewDeposit(lpAmount);
        _deposit(_msgSender(), receiver, lpAmount, shares_);

        return shares_;
    }

    /**
     * @dev Override to handle LP token withdrawals with fees
     * @param lpAmount This is the net amount of LP tokens the user wants to receive.
     * @param receiver Address to receive LP tokens
     * @param owner Address that owns the shares
     * @return shares_ Amount of shares burned
     */
    function withdraw(
        uint256 lpAmount,
        address receiver,
        address owner
    )
        public
        virtual
        override(ERC4626, IERC4626)
        nonReentrant
        returns (uint256 shares_)
    {
        shares_ = previewWithdraw(lpAmount);
        uint256 grossLpAmount = convertToAssets(shares_);

        require(
            grossLpAmount <= maxWithdraw(owner),
            "ERC4626: withdraw more than max"
        );

        _withdraw(_msgSender(), receiver, owner, grossLpAmount, shares_);

        return shares_;
    }

    /**
     * @dev Internal deposit function
     * @param caller Address calling the deposit
     * @param receiver Address to receive shares
     * @param lpAmount Amount of LP tokens being deposited
     * @param shares Amount of shares to mint
     */
    function _deposit(
        address caller,
        address receiver,
        uint256 lpAmount,
        uint256 shares
    ) internal virtual override {
        if (shares == 0) {
            revert ZeroShares();
        }
        IERC20(LP_TOKEN).safeTransferFrom(caller, address(this), lpAmount);
        _mint(receiver, shares);
        emit Deposit(caller, receiver, lpAmount, shares);
    }

    /**
     * @dev Internal withdraw function with fee handling
     * @param caller Address calling the withdrawal
     * @param receiver Address to receive LP tokens
     * @param owner Address that owns the shares
     * @param grossLpAmount Amount of LP tokens to withdraw (gross amount, before fees)
     * @param shares Amount of shares to burn
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 grossLpAmount,
        uint256 shares
    ) internal virtual override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        uint256 feeInLP = _calculateWithdrawalFee(grossLpAmount);
        uint256 lpTokensToSend = grossLpAmount - feeInLP;

        uint256 lpBalance = IERC20(LP_TOKEN).balanceOf(address(this));
        if (lpBalance < grossLpAmount) {
            revert InsufficientLPTokens();
        }

        _burn(owner, shares);
        IERC20(LP_TOKEN).safeTransfer(receiver, lpTokensToSend);

        // Emit ERC4626 Withdraw event with the NET LP tokens that were actually sent to the receiver
        emit Withdraw(caller, receiver, owner, lpTokensToSend, shares);
    }

    // --- Fee management ---

    /// @inheritdoc IDPoolVaultLP
    function setWithdrawalFee(
        uint256 newFeeBps
    ) external override onlyRole(FEE_MANAGER_ROLE) {
        _setWithdrawalFee(newFeeBps);
    }

    // --- Access control ---

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
