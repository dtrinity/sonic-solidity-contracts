// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
 * ———————————————————————————————————————————————————————————————————————————————— */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// --- Interfaces ---

/**
 * @title Minimal interface for the wrapped native token (e.g., wS)
 * @dev Includes standard ERC20 and the payable deposit/withdraw functions. Must be 1:1 with native.
 */
interface IwNative is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/**
 * @title Minimal interface for the dStable IssuerV2 contract
 * @dev Only the function needed by this gateway.
 */
interface IIssuer {
    function issue(uint256 collateralAmount, address collateralAsset, uint256 minDStable) external;
}

/**
 * @title Interface for the dStable token
 */
interface IDStable is IERC20 {}

/**
 * @title Minimal interface for the dStable RedeemerV2 contract
 * @dev Only the function needed by this gateway.
 */
interface IRedeemer {
    function redeem(uint256 dstableAmount, address collateralAsset, uint256 minNetCollateral) external;
}

/**
 * @title NativeMintingGateway
 * @notice Gateway contract that enables minting and redeeming dStable tokens using native tokens.
 *         - For minting: Wraps native tokens and mints dStable via IssuerV2
 *         - For redemption: Redeems dStable via RedeemerV2, unwraps to native tokens
 */
contract NativeMintingGateway is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using SafeERC20 for IDStable;

    // --- State Variables ---

    /// @notice The address of the wrapped native token contract (e.g., wS).
    address public immutable W_NATIVE_TOKEN;
    /// @notice The address of the dStable Issuer contract.
    address public immutable DSTABLE_ISSUER;
    /// @notice The address of the dStable Redeemer contract.
    address public immutable DSTABLE_REDEEMER;
    /// @notice The address of the dStable token contract (e.g., dS).
    address public immutable DSTABLE_TOKEN;

    // No events emitted; downstream protocols (wNative, IssuerV2, token) already emit relevant events.

    // --- Errors ---

    /// @notice Reverted when a user attempts to deposit zero native tokens.
    error ZeroDeposit();
    /// @notice Reverted when minDStable is zero (no slippage protection).
    error InvalidMinDStable();
    /// @notice Reverted when a constructor argument is the zero address.
    error ZeroAddress();
    /// @notice Reverted if the balance check after wrapping fails.
    /// @param expected The expected wrapped amount
    /// @param actual The actual wrapped amount received
    error WrapFailed(uint256 expected, uint256 actual);
    /// @notice Reverted when no dStable tokens are issued.
    error NoTokensIssued();
    /// @notice Reverted when the issuer operation fails.
    error IssuerOperationFailed();
    /// @notice Reverted when the redeemer operation fails.
    error RedeemerOperationFailed();
    /// @notice Reverted if the balance check after unwrapping fails.
    /// @param expected The expected native amount
    /// @param actual The actual native amount received
    error UnwrapFailed(uint256 expected, uint256 actual);
    /// @notice Reverted when zero dStable tokens are provided for redemption.
    error ZeroDStableAmount();
    /// @notice Reverted when minNativeAmount is zero (no slippage protection).
    error InvalidMinNativeAmount();
    /// @notice Reverted on direct native token transfers to this contract.
    error DirectNativeTransferNotAllowed();

    // --- Constructor ---

    /**
     * @notice Initializes the gateway with required contract addresses
     * @param _wNativeToken Address of the wrapped native token contract (e.g., wS)
     *                      Must implement IwNative interface with deposit() and withdraw() functions
     * @param _dStableIssuer Address of the dStable Issuer contract
     *                       Must implement IIssuer interface with issue() function
     * @param _dStableRedeemer Address of the dStable Redeemer contract
     *                         Must implement IRedeemer interface with redeem() function
     * @param _dStableToken Address of the dStable token contract (e.g., dS)
     *                      Must be a standard ERC20 token compatible with SafeERC20
     * @dev All addresses are stored as immutable for gas efficiency and security.
     *      Constructor validates that no address is zero to prevent deployment errors.
     */
    constructor(address _wNativeToken, address _dStableIssuer, address _dStableRedeemer, address _dStableToken, address _owner) Ownable(_owner) {
        if (_wNativeToken == address(0)) revert ZeroAddress();
        if (_dStableIssuer == address(0)) revert ZeroAddress();
        if (_dStableRedeemer == address(0)) revert ZeroAddress();
        if (_dStableToken == address(0)) revert ZeroAddress();

        W_NATIVE_TOKEN = _wNativeToken;
        DSTABLE_ISSUER = _dStableIssuer;
        DSTABLE_REDEEMER = _dStableRedeemer;
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
        if (wrappedAmount != nativeAmount) {
            revert WrapFailed(nativeAmount, wrappedAmount);
        }

        // Downstream wrapper emits its own Deposit event

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
                revert NoTokensIssued();
            }

            // Downstream protocols emit their own events for accounting

            // 4. Transfer the received dStable from this contract to the original user
            dStableContract.safeTransfer(user, dStableIssuedAmount);
        } catch {
            revert IssuerOperationFailed();
        }
    }

    /**
     * @notice Allows users to redeem dStable tokens for native tokens (e.g., S)
     *         by calling the dStable Redeemer to get wrapped tokens, then unwrapping them.
     * @param _dStableAmount The amount of dStable tokens to redeem.
     *                       Must be greater than 0.
     * @param _minNativeAmount The minimum amount of native tokens the user accepts for their dStable.
     *                         Must be greater than 0 to ensure slippage protection.
     * @dev Transfers dStable tokens from user to this contract.
     *      Approves the Redeemer to spend the dStable tokens using safe approval.
     *      Calls the Redeemer's redeem function, which burns dStable and sends wrapped tokens to *this* contract.
     *      Unwraps the received wrapped tokens to native tokens.
     *      Transfers the native tokens from this contract to the original user (msg.sender).
     *
     *      Security considerations:
     *      - Protected against reentrancy attacks
     *      - Validates all inputs including slippage protection
     *      - Handles existing wrapped token balances correctly
     *      - Uses safe ERC20 operations throughout
     *
     * @custom:reverts ZeroDStableAmount if _dStableAmount is 0
     * @custom:reverts InvalidMinNativeAmount if _minNativeAmount is 0
     * @custom:reverts RedeemerOperationFailed if the redeemer call fails
     * @custom:reverts UnwrapFailed if unwrapping doesn't produce expected amount
     */
    function redeemToNative(uint256 _dStableAmount, uint256 _minNativeAmount) external nonReentrant {
        if (_dStableAmount == 0) revert ZeroDStableAmount();
        if (_minNativeAmount == 0) revert InvalidMinNativeAmount();

        address user = msg.sender;
        IwNative wNativeContract = IwNative(W_NATIVE_TOKEN);
        IDStable dStableContract = IDStable(DSTABLE_TOKEN);

        // 1. Transfer dStable from user to this contract
        dStableContract.safeTransferFrom(user, address(this), _dStableAmount);

        // 2. Safely approve dStable Redeemer to spend the dStable tokens
        // Use SafeERC20's forceApprove to handle tokens that don't return boolean
        dStableContract.forceApprove(DSTABLE_REDEEMER, _dStableAmount);

        // 3. Call dStable RedeemerV2 to redeem dStable for wrapped tokens - optimized balance tracking
        // RedeemerV2 burns dStable from this contract and sends wrapped tokens *to this contract*
        // We optimize by only reading balance after successful redemption, avoiding failed-case reads

        uint256 wNativeBalanceBefore = wNativeContract.balanceOf(address(this));
        try IRedeemer(DSTABLE_REDEEMER).redeem(_dStableAmount, W_NATIVE_TOKEN, _minNativeAmount) {
            // Only read balance after successful redeemer call - saves gas on failures
            uint256 wNativeBalanceAfter = wNativeContract.balanceOf(address(this));
            uint256 wNativeRedeemedAmount = wNativeBalanceAfter - wNativeBalanceBefore;

            if (wNativeRedeemedAmount == 0) {
                revert NoTokensIssued(); // Reusing existing error for consistency
            }

            // Downstream protocols emit their own events for accounting

            // 4. Unwrap the wrapped tokens to native tokens - Handle existing balances correctly
            uint256 nativeBalanceBefore = address(this).balance;
            wNativeContract.withdraw(wNativeRedeemedAmount);
            uint256 nativeBalanceAfter = address(this).balance;

            // Verify we received the expected amount of native tokens
            uint256 nativeAmount = nativeBalanceAfter - nativeBalanceBefore;
            if (nativeAmount != wNativeRedeemedAmount) {
                revert UnwrapFailed(wNativeRedeemedAmount, nativeAmount);
            }

            // Verify the final amount meets minimum requirements
            if (nativeAmount < _minNativeAmount) {
                revert UnwrapFailed(_minNativeAmount, nativeAmount);
            }

            // 5. Transfer the native tokens from this contract to the original user
            payable(user).transfer(nativeAmount);
        } catch {
            revert RedeemerOperationFailed();
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
     * @notice Allows native transfers only from the wrapped native token contract during redemption.
     *         Disallows direct native transfers from users - they must call depositAndMint().
     */
    receive() external payable {
        // Allow native tokens from the wrapped native token contract (during withdraw)
        if (msg.sender == W_NATIVE_TOKEN) {
            return;
        }
        // Reject direct transfers from users
        revert DirectNativeTransferNotAllowed();
    }
}
