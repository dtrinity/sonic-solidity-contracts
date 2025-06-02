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
    IDPoolVaultLP
{
    using SafeERC20 for IERC20;

    // --- Constants ---

    /// @notice Role identifier for fee management
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    /// @notice Maximum withdrawal fee (5%)
    uint256 public constant MAX_WITHDRAWAL_FEE_BPS =
        5 * BasisPointConstants.ONE_PERCENT_BPS;

    // --- Immutables ---

    /// @notice Address of the LP token this vault accepts (same as asset())
    address public immutable LP_TOKEN;

    // --- State variables ---

    /// @notice Current withdrawal fee in basis points
    uint256 public withdrawalFeeBps;

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
    }

    // --- View functions ---

    /// @inheritdoc IDPoolVaultLP
    function lpToken() external view returns (address) {
        return LP_TOKEN;
    }

    /// @inheritdoc IDPoolVaultLP
    function maxWithdrawalFeeBps() external pure returns (uint256) {
        return MAX_WITHDRAWAL_FEE_BPS;
    }

    // --- Abstract functions ---

    /**
     * @notice Get the DEX pool address - must be implemented by each DEX-specific vault
     * @return Address of the DEX pool
     */
    function pool() external view virtual returns (address);

    /**
     * @notice Preview base asset value for LP tokens - must be implemented by each DEX-specific vault
     * @dev This is an auxiliary function for external valuation, not used in core ERC4626 mechanics
     * @param lpAmount Amount of LP tokens
     * @return Base asset value
     */
    function previewLPValue(
        uint256 lpAmount
    ) external view virtual returns (uint256);

    /// @inheritdoc IDPoolVaultLP
    function previewDepositLP(
        uint256 lpAmount
    ) external view returns (uint256 shares) {
        return previewDeposit(lpAmount);
    }

    // --- Deposit/withdrawal logic ---

    /**
     * @dev Override to handle LP token deposits
     * @param lpAmount Amount of LP tokens to deposit
     * @param receiver Address to receive vault shares
     * @return shares Amount of shares minted
     */
    function deposit(
        uint256 lpAmount,
        address receiver
    )
        public
        virtual
        override(ERC4626, IERC4626)
        nonReentrant
        returns (uint256 shares)
    {
        require(
            lpAmount <= maxDeposit(receiver),
            "ERC4626: deposit more than max"
        );

        shares = previewDeposit(lpAmount);
        _deposit(_msgSender(), receiver, lpAmount, shares);

        return shares;
    }

    /**
     * @dev Override to handle LP token withdrawals with fees
     * @param lpAmount Amount of LP tokens to withdraw
     * @param receiver Address to receive LP tokens
     * @param owner Address that owns the shares
     * @return shares Amount of shares burned
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
        returns (uint256 shares)
    {
        require(
            lpAmount <= maxWithdraw(owner),
            "ERC4626: withdraw more than max"
        );

        shares = previewWithdraw(lpAmount);
        _withdraw(_msgSender(), receiver, owner, lpAmount, shares);

        return shares;
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
        // Pull LP tokens from caller
        IERC20(LP_TOKEN).safeTransferFrom(caller, address(this), lpAmount);

        // Mint shares to receiver
        _mint(receiver, shares);

        emit Deposit(caller, receiver, lpAmount, shares);
    }

    /**
     * @dev Internal withdraw function with fee handling
     * @param caller Address calling the withdrawal
     * @param receiver Address to receive LP tokens
     * @param owner Address that owns the shares
     * @param lpAmount Amount of LP tokens to withdraw (before fees)
     * @param shares Amount of shares to burn
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 lpAmount,
        uint256 shares
    ) internal virtual override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        // Calculate withdrawal fee on LP tokens
        uint256 feeInLP = (lpAmount * withdrawalFeeBps) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        uint256 lpTokensToSend = lpAmount - feeInLP;

        // Check if we have enough LP tokens
        uint256 lpBalance = IERC20(LP_TOKEN).balanceOf(address(this));
        if (lpBalance < lpAmount) {
            revert InsufficientLPTokens();
        }

        // Burn shares
        _burn(owner, shares);

        // Send LP tokens to receiver (minus fees)
        IERC20(LP_TOKEN).safeTransfer(receiver, lpTokensToSend);

        emit Withdraw(caller, receiver, owner, lpAmount, shares);
    }

    // --- Fee management ---

    /// @inheritdoc IDPoolVaultLP
    function setWithdrawalFee(
        uint256 newFeeBps
    ) external onlyRole(FEE_MANAGER_ROLE) {
        if (newFeeBps > MAX_WITHDRAWAL_FEE_BPS) {
            revert ExcessiveWithdrawalFee();
        }

        withdrawalFeeBps = newFeeBps;
        emit WithdrawalFeeUpdated(newFeeBps);
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
