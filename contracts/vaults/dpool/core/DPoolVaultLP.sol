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
 * @notice Abstract base ERC4626 vault that accepts LP tokens and values them in base asset terms
 * @dev Each vault represents a specific LP position on a specific DEX
 */
abstract contract DPoolVaultLP is ERC4626, AccessControl, ReentrancyGuard, IDPoolVaultLP {
    using SafeERC20 for IERC20;

    // --- Constants ---

    /// @notice Role identifier for fee management
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    /// @notice Maximum withdrawal fee (5%)
    uint256 public constant MAX_WITHDRAWAL_FEE_BPS = 5 * BasisPointConstants.ONE_PERCENT_BPS;

    // --- Immutables ---

    /// @notice Address of the LP token this vault accepts
    address public immutable LP_TOKEN;

    // --- State variables ---

    /// @notice Current withdrawal fee in basis points
    uint256 public withdrawalFeeBps;

    // --- Constructor ---

    /**
     * @notice Initialize the vault
     * @param baseAsset Address of the base asset for consistent valuation
     * @param _lpToken Address of the LP token this vault accepts
     * @param name Vault token name
     * @param symbol Vault token symbol
     * @param admin Address to grant admin role
     */
    constructor(
        address baseAsset,
        address _lpToken,
        string memory name,
        string memory symbol,
        address admin
    ) ERC4626(IERC20(baseAsset)) ERC20(name, symbol) {
        if (baseAsset == address(0)) revert("Invalid base asset");
        if (_lpToken == address(0)) revert("Invalid LP token");
        if (admin == address(0)) revert("Invalid admin");

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
     * @param lpAmount Amount of LP tokens
     * @return Base asset value
     */
    function previewLPValue(uint256 lpAmount) external view virtual returns (uint256);

    /// @inheritdoc IDPoolVaultLP
    function previewDepositLP(uint256 lpAmount) external view returns (uint256 shares) {
        return previewDeposit(lpAmount);
    }

    /// @inheritdoc IDPoolVaultLP
    function previewWithdrawLP(uint256 assets) external view returns (uint256 lpAmount) {
        return previewWithdraw(assets);
    }

    // --- Deposit/withdrawal logic ---

    /**
     * @dev Override to handle LP token deposits
     */
    function deposit(uint256 assets, address receiver) public virtual override(ERC4626, IERC4626) nonReentrant returns (uint256 shares) {
        require(assets <= maxDeposit(receiver), "ERC4626: deposit more than max");

        shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);

        return shares;
    }

    /**
     * @dev Override to handle LP token withdrawals with fees
     */
    function withdraw(uint256 assets, address receiver, address owner) 
        public 
        virtual 
        override(ERC4626, IERC4626) 
        nonReentrant 
        returns (uint256 shares) 
    {
        require(assets <= maxWithdraw(owner), "ERC4626: withdraw more than max");

        shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner, assets, shares);

        return shares;
    }

    /**
     * @dev Internal deposit function
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
        // Pull LP tokens from caller
        IERC20(LP_TOKEN).safeTransferFrom(caller, address(this), assets);

        // Mint shares to receiver
        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    /**
     * @dev Internal withdraw function with fee handling
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

        // Calculate withdrawal fee
        uint256 fee = (assets * withdrawalFeeBps) / BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        uint256 lpTokensToSend = assets - fee;

        // Check if we have enough LP tokens
        uint256 lpBalance = IERC20(LP_TOKEN).balanceOf(address(this));
        if (lpBalance < lpTokensToSend) {
            revert InsufficientLPTokens();
        }

        // Burn shares
        _burn(owner, shares);

        // Send LP tokens to receiver (minus fees)
        IERC20(LP_TOKEN).safeTransfer(receiver, lpTokensToSend);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    // --- Fee management ---

    /// @inheritdoc IDPoolVaultLP
    function setWithdrawalFee(uint256 newFeeBps) external onlyRole(FEE_MANAGER_ROLE) {
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
    function supportsInterface(bytes4 interfaceId) 
        public 
        view 
        virtual 
        override(AccessControl) 
        returns (bool) 
    {
        return super.supportsInterface(interfaceId);
    }
} 