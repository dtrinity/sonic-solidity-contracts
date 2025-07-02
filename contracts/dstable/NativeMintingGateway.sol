// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// --- Interfaces ---

/**
 * @title Minimal interface for the wrapped native token (e.g., wS)
 * @dev Includes standard ERC20 and the payable deposit function.
 */
interface IwNative is IERC20 {
    function deposit() external payable;
}

/**
 * @title Minimal interface for the dStable Issuer contract
 * @dev Contains the function needed by the gateway.
 */
interface IIssuer {
    /**
     * @notice Issues dStable tokens in exchange for collateral from the caller
     * @param collateralAmount The amount of collateral to deposit
     * @param collateralAsset The address of the collateral asset
     * @param minDStable The minimum amount of dStable to receive, used for slippage protection
     * @dev The Issuer pulls collateral from msg.sender and mints dStable to msg.sender.
     */
    function issue(
        uint256 collateralAmount,
        address collateralAsset,
        uint256 minDStable
    ) external;
}

/**
 * @title Interface for the dStable token
 * @dev Assumed to be compatible with IMintableERC20 and standard ERC20 functions.
 *      We primarily need balanceOf and transfer.
 */
interface IDStable is IERC20 {
    // No extra functions needed beyond standard IERC20 for this gateway's core logic
}

/**
 * @title NativeMintingGateway
 * @notice Allows users to deposit the native network token (e.g., S on Sonic)
 *         to mint the dStable token (e.g., dS) via the dStable Issuer.
 * @dev Wraps the native token into its ERC20 representation (e.g., wS),
 *      then uses that wrapped token as collateral with the Issuer.
 */
contract NativeMintingGateway {
    using SafeERC20 for IERC20;
    using SafeERC20 for IDStable;

    // --- State Variables ---

    /// @notice The address of the wrapped native token contract (e.g., wS).
    address public immutable W_NATIVE_TOKEN;
    /// @notice The address of the dStable Issuer contract.
    address public immutable DSTABLE_ISSUER;
    /// @notice The address of the dStable token contract (e.g., dS).
    address public immutable DSTABLE_TOKEN;

    // --- Events ---

    event NativeWrapped(
        address indexed user,
        uint256 nativeAmount,
        uint256 wrappedAmount
    );
    event TokenIssued(
        address indexed user,
        address indexed collateral,
        uint256 collateralAmount,
        uint256 stablecoinAmount
    );

    // --- Errors ---

    /// @notice Reverted when a user attempts to deposit zero native tokens.
    error ZeroDeposit();
    /// @notice Reverted when a constructor argument is the zero address.
    error ZeroAddress();
    /// @notice Reverted if the ERC20 approve call fails.
    error ApproveFailed();
    /// @notice Reverted if the balance check after wrapping fails (if check is enabled).
    error WrapFailed();

    // --- Constructor ---

    /**
     * @param _wNativeToken Address of the wrapped native token contract (e.g., wS).
     * @param _dStableIssuer Address of the dStable Issuer contract.
     * @param _dStableToken Address of the dStable token contract (e.g., dS).
     */
    constructor(
        address _wNativeToken,
        address _dStableIssuer,
        address _dStableToken
    ) {
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
     * @dev Sends native token (msg.value) to the wNative contract to wrap.
     *      Approves the Issuer to spend the wrapped tokens.
     *      Calls the Issuer's issue function, which mints dStable to *this* contract.
     *      Transfers the received dStable from this contract to the original user (msg.sender).
     */
    function depositNativeAndMintStable(uint256 _minDStable) external payable {
        uint256 nativeAmount = msg.value;
        if (nativeAmount == 0) revert ZeroDeposit();

        address user = msg.sender;
        IwNative wNativeContract = IwNative(W_NATIVE_TOKEN);
        IDStable dStableContract = IDStable(DSTABLE_TOKEN);

        // 1. Wrap Native Token
        // Assumes 1:1 wrapping rate and same decimals
        uint256 wrappedAmount = nativeAmount;
        wNativeContract.deposit{value: nativeAmount}();
        // Optional sanity check:
        if (wNativeContract.balanceOf(address(this)) < wrappedAmount)
            revert WrapFailed();

        emit NativeWrapped(user, nativeAmount, wrappedAmount);

        // 2. Approve dStable Issuer to spend the wrapped token held by this contract
        // Use standard approve instead of safeApprove (which might be deprecated/removed)
        // Cast to IERC20 is still appropriate here.
        bool success = IERC20(W_NATIVE_TOKEN).approve(
            DSTABLE_ISSUER,
            wrappedAmount
        );
        if (!success) revert ApproveFailed();

        // 3. Call dStable Issuer to issue dStable
        // The Issuer's 'issue' function mints dStable *to this contract* (msg.sender of the call)
        uint256 dStableBalanceBefore = dStableContract.balanceOf(address(this));
        IIssuer(DSTABLE_ISSUER).issue(
            wrappedAmount,
            W_NATIVE_TOKEN,
            _minDStable
        );
        uint256 dStableBalanceAfter = dStableContract.balanceOf(address(this));

        // Calculate the amount of dStable actually issued to this contract
        uint256 dStableIssuedAmount = dStableBalanceAfter -
            dStableBalanceBefore;

        // Emit event regardless of amount, useful for tracking attempts
        emit TokenIssued(
            user,
            W_NATIVE_TOKEN,
            wrappedAmount,
            dStableIssuedAmount
        );

        // 4. Transfer the received dStable from this contract to the original user
        if (dStableIssuedAmount > 0) {
            // Using SafeERC20's safeTransfer ensures the transfer completes successfully
            dStableContract.safeTransfer(user, dStableIssuedAmount);
        }
        // If dStableIssuedAmount is 0 (e.g., slippage hit hard, oracle price was 0),
        // no transfer occurs, and the user effectively only wrapped their native token.
        // The wrapped tokens remain approved for the Issuer but aren't spent.
        // Consider if unwrapping/returning wS is desired in the zero-issuance case.
    }

    // --- Receive Fallback ---

    /**
     * @notice Allows the contract to receive native tokens directly (e.g., via simple transfer).
     * @dev Recommended to prevent locking funds, though users should use depositNativeAndMintStable.
     */
    receive() external payable {}
}
