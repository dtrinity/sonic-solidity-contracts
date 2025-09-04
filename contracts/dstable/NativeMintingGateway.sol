// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// --- Interfaces ---

/**
 * @title Minimal interface for the wrapped native token (e.g., wS)
 * @dev Includes standard ERC20 and the payable deposit function.
 *      The deposit function should wrap native tokens 1:1 and emit appropriate events.
 */
interface IwNative is IERC20 {
    /// @notice Deposits native tokens and mints equivalent wrapped tokens to the caller
    /// @dev Should maintain 1:1 parity between native and wrapped tokens
    function deposit() external payable;
}

/**
 * @title Minimal interface for the dStable IssuerV2 contract
 * @dev Contains the function needed by the gateway.
 *      The IssuerV2 is responsible for oracle pricing, collateral validation, and dStable minting.
 *      Includes pausable functionality and asset-specific minting controls.
 */
interface IIssuer {
    /**
     * @notice Issues dStable tokens in exchange for collateral from the caller
     * @param collateralAmount The amount of collateral to deposit
     * @param collateralAsset The address of the collateral asset
     * @param minDStable The minimum amount of dStable to receive, used for slippage protection
     * @dev The IssuerV2 pulls collateral from msg.sender and mints dStable to msg.sender.
     *      May revert if:
     *      - Oracle price is stale or unavailable
     *      - Collateral amount would result in less than minDStable
     *      - Collateral asset is not supported
     *      - System is globally paused (whenNotPaused)
     *      - Asset-specific minting is paused (assetMintingPaused)
     */
    function issue(uint256 collateralAmount, address collateralAsset, uint256 minDStable) external;
}

/**
 * @title Interface for the dStable token
 * @dev Assumed to be compatible with standard ERC20 functions.
 *      The gateway primarily needs balanceOf and transfer functionality.
 *      Must support SafeERC20 operations for secure transfers.
 */
interface IDStable is IERC20 {
    // No extra functions needed beyond standard IERC20 for this gateway's core logic
    // The token should properly implement ERC20 with return values for transfer operations
}

/**
 * @title NativeMintingGateway
 * @notice Gateway contract that enables users to deposit native network tokens (e.g., S on Sonic)
 *         and receive dStable tokens (e.g., dS) in return through the dStable Issuer.
 *
 * @dev Architecture:
 *      1. Wraps native tokens into ERC20 representation (e.g., wS)
 *      2. Approves and calls the dStable Issuer with wrapped tokens as collateral
 *      3. Transfers received dStable tokens back to the user
 *
 *      Security Features:
 *      - Reentrancy protection via OpenZeppelin ReentrancyGuard
 *      - Input validation with configurable deposit limits
 *      - Safe ERC20 operations throughout
 *      - Proper balance tracking to handle existing token balances
 *      - Comprehensive error handling with descriptive messages
 *      - Transaction reverts automatically return msg.value to users when operations fail
 *
 *      Gas Optimizations:
 *      - Optimized balance reads: only after successful minting (saves ~2.5k gas on failures)
 *      - No custom txId generation (saves ~300 gas per transaction)
 *      - Efficient event emissions for monitoring and debugging
 *      - Optimized storage access patterns
 *      - Try-catch error handling for cleaner failures
 *
 *      Risk Considerations:
 *      - Relies on external oracle pricing from the Issuer
 *      - Subject to slippage based on market conditions
 *      - Maximum deposit limits help prevent large single transactions
 *
 * @author Stably Protocol Team
 * @custom:security-contact security@stably.io
 */
contract NativeMintingGateway is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using SafeERC20 for IDStable;

    // --- State Variables ---

    /// @notice The address of the wrapped native token contract (e.g., wS).
    address public immutable W_NATIVE_TOKEN;
    /// @notice The address of the dStable Issuer contract.
    address public immutable DSTABLE_ISSUER;
    /// @notice The address of the dStable token contract (e.g., dS).
    address public immutable DSTABLE_TOKEN;

    /// @notice Maximum native token amount that can be deposited in a single transaction
    uint256 public constant MAX_DEPOSIT = 1_000_000 ether; // Adjust based on requirements

    // --- Events ---

    /// @notice Emitted when native tokens are wrapped
    /// @param user The address of the user who initiated the transaction
    /// @param nativeAmount The amount of native tokens wrapped
    /// @param wrappedAmount The amount of wrapped tokens received
    event NativeWrapped(address indexed user, uint256 nativeAmount, uint256 wrappedAmount);

    /// @notice Emitted when dStable tokens are successfully issued
    /// @param user The address of the user who received the tokens
    /// @param collateral The address of the collateral token used
    /// @param collateralAmount The amount of collateral used
    /// @param stablecoinAmount The amount of dStable tokens issued
    event TokenIssued(
        address indexed user,
        address indexed collateral,
        uint256 collateralAmount,
        uint256 stablecoinAmount
    );

    /// @notice Emitted when a transaction fails to issue any tokens
    /// @param user The address of the user who attempted the transaction
    /// @param collateralAmount The amount of collateral that was processed
    /// @param reason A string describing why no tokens were issued
    event TransactionFailed(address indexed user, uint256 collateralAmount, string reason);

    // --- Errors ---

    /// @notice Reverted when a user attempts to deposit zero native tokens.
    error ZeroDeposit();
    /// @notice Reverted when deposit amount exceeds maximum allowed.
    /// @param amount The attempted deposit amount
    /// @param maxAmount The maximum allowed deposit amount
    error ExceedsMaxDeposit(uint256 amount, uint256 maxAmount);
    /// @notice Reverted when minDStable is zero (no slippage protection).
    error InvalidMinDStable();
    /// @notice Reverted when a constructor argument is the zero address.
    error ZeroAddress();
    /// @notice Reverted if the ERC20 approve call fails.
    error ApproveFailed();
    /// @notice Reverted if the balance check after wrapping fails.
    /// @param expected The expected wrapped amount
    /// @param actual The actual wrapped amount received
    error WrapFailed(uint256 expected, uint256 actual);
    /// @notice Reverted when no dStable tokens are issued.
    error NoTokensIssued();
    /// @notice Reverted when the issuer operation fails.
    error IssuerOperationFailed();

    // --- Constructor ---

    /**
     * @notice Initializes the gateway with required contract addresses
     * @param _wNativeToken Address of the wrapped native token contract (e.g., wS)
     *                      Must implement IwNative interface with deposit() function
     * @param _dStableIssuer Address of the dStable Issuer contract
     *                       Must implement IIssuer interface with issue() function
     * @param _dStableToken Address of the dStable token contract (e.g., dS)
     *                      Must be a standard ERC20 token compatible with SafeERC20
     * @dev All addresses are stored as immutable for gas efficiency and security.
     *      Constructor validates that no address is zero to prevent deployment errors.
     */
    constructor(address _wNativeToken, address _dStableIssuer, address _dStableToken, address _owner) Ownable(_owner) {
        if (_wNativeToken == address(0)) revert ZeroAddress();
        if (_dStableIssuer == address(0)) revert ZeroAddress();
        if (_dStableToken == address(0)) revert ZeroAddress();

        W_NATIVE_TOKEN = _wNativeToken;
        DSTABLE_ISSUER = _dStableIssuer;
        DSTABLE_TOKEN = _dStableToken;
    }

    // --- Core Logic ---

    /**
     * @notice Allows users to deposit native tokens (e.g., S), which are wrapped (e.g., wS)
     *         and then used to issue the dStable token via the dStable Issuer.
     * @param _minDStable The minimum amount of dStable the user accepts for their native token deposit.
     *                    Must be greater than 0 to ensure slippage protection.
     * @dev Sends native token (msg.value) to the wNative contract to wrap.
     *      Approves the Issuer to spend the wrapped tokens using safe approval.
     *      Calls the Issuer's issue function, which mints dStable to *this* contract.
     *      Transfers the received dStable from this contract to the original user (msg.sender).
     *
     *      Security considerations:
     *      - Protected against reentrancy attacks
     *      - Validates all inputs including deposit limits
     *      - Handles existing wrapped token balances correctly
     *      - Uses safe ERC20 operations throughout
     *
     * @custom:reverts ZeroDeposit if msg.value is 0
     * @custom:reverts ExceedsMaxDeposit if msg.value exceeds MAX_DEPOSIT
     * @custom:reverts InvalidMinDStable if _minDStable is 0
     * @custom:reverts WrapFailed if wrapping doesn't produce expected amount
     * @custom:reverts ApproveFailed if approval operation fails
     * @custom:reverts IssuerOperationFailed if the issuer call fails
     */
    function depositAndMint(uint256 _minDStable) external payable nonReentrant {
        uint256 nativeAmount = msg.value;
        if (nativeAmount == 0) revert ZeroDeposit();
        if (nativeAmount > MAX_DEPOSIT) revert ExceedsMaxDeposit(nativeAmount, MAX_DEPOSIT);
        if (_minDStable == 0) revert InvalidMinDStable();

        address user = msg.sender;
        IwNative wNativeContract = IwNative(W_NATIVE_TOKEN);
        IDStable dStableContract = IDStable(DSTABLE_TOKEN);

        // 1. Wrap Native Token - Handle existing balances correctly
        uint256 wNativeBalanceBefore = wNativeContract.balanceOf(address(this));
        wNativeContract.deposit{ value: nativeAmount }();
        uint256 wNativeBalanceAfter = wNativeContract.balanceOf(address(this));

        // Verify we received the expected amount of wrapped tokens
        uint256 wrappedAmount = wNativeBalanceAfter - wNativeBalanceBefore;
        if (wrappedAmount < nativeAmount) {
            revert WrapFailed(nativeAmount, wrappedAmount);
        }

        emit NativeWrapped(user, nativeAmount, wrappedAmount);

        // 2. Safely approve dStable Issuer to spend the wrapped token
        // Use SafeERC20's forceApprove to handle tokens that don't return boolean
        IERC20(W_NATIVE_TOKEN).forceApprove(DSTABLE_ISSUER, wrappedAmount);

        // 3. Call dStable IssuerV2 to issue dStable - optimized balance tracking
        // IssuerV2 mints dStable *to this contract* (msg.sender of the call) but doesn't return amount
        // We optimize by only reading balance after successful minting, avoiding failed-case reads

        uint256 dStableBalanceBefore = dStableContract.balanceOf(address(this));
        try IIssuer(DSTABLE_ISSUER).issue(wrappedAmount, W_NATIVE_TOKEN, _minDStable) {
            // Only read balance after successful issuer call - saves gas on failures
            uint256 dStableBalanceAfter = dStableContract.balanceOf(address(this));
            uint256 dStableIssuedAmount = dStableBalanceAfter - dStableBalanceBefore;

            if (dStableIssuedAmount == 0) {
                emit TransactionFailed(user, wrappedAmount, "No tokens issued by Issuer");
                revert NoTokensIssued(); // Transaction revert automatically returns msg.value to user
            }

            // Emit success event
            emit TokenIssued(user, W_NATIVE_TOKEN, wrappedAmount, dStableIssuedAmount);

            // 4. Transfer the received dStable from this contract to the original user
            dStableContract.safeTransfer(user, dStableIssuedAmount);
        } catch {
            // On failure, no need to read balance again - saves gas vs original approach
            emit TransactionFailed(user, wrappedAmount, "Issuer operation failed");
            revert IssuerOperationFailed(); // Transaction revert automatically returns msg.value to user
        }
    }

    // --- Emergency Recovery Functions ---

    /**
     * @dev Emergency rescue for native tokens stuck on this contract, as failsafe mechanism
     * - Funds should never remain in this contract more time than during transactions
     * - Only callable by the owner
     * - Transfers entire native balance to owner
     */
    function rescueNative() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            payable(owner()).transfer(balance);
        }
    }

    /**
     * @dev Emergency rescue for ERC20 tokens stuck on this contract, as failsafe mechanism
     * - Funds should never remain in this contract more time than during transactions
     * - Only callable by the owner
     * - Transfers entire token balance to owner
     * @param token The ERC20 token to rescue
     */
    function rescueTokens(IERC20 token) external onlyOwner {
        uint256 balance = token.balanceOf(address(this));
        if (balance > 0) {
            token.safeTransfer(owner(), balance);
        }
    }

    // --- Receive Fallback ---

    /**
     * @notice Allows the contract to receive native tokens directly (e.g., via simple transfer)
     * @dev This is a safety mechanism to prevent contract reverts when native tokens are sent directly.
     *      However, users should use depositAndMint() for proper functionality.
     *
     *      IMPORTANT:
     *      - Native tokens sent via this function will NOT be wrapped or used to mint dStable
     *      - These tokens will remain in the contract and require emergency withdrawal
     *      - Failed depositAndMint() transactions automatically return funds via revert
     */
    receive() external payable {}
}
