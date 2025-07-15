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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IDPoolPeriphery.sol";
import "../core/interfaces/IDPoolVaultLP.sol";
import "../core/interfaces/ICurveStableSwapNG.sol";
import "../../../common/BasisPointConstants.sol";

/**
 * @title DPoolCurvePeriphery
 * @author dTRINITY Protocol
 * @notice Curve periphery contract that handles asset conversions to/from LP tokens
 * @dev Converts pool assets to LP tokens and deposits to vault, or withdraws from vault and converts LP to assets
 */
contract DPoolCurvePeriphery is
    AccessControl,
    ReentrancyGuard,
    IDPoolPeriphery
{
    using SafeERC20 for IERC20;

    // --- Constants ---

    /// @notice Maximum allowed slippage (10%)
    uint256 public constant MAX_SLIPPAGE_BPS =
        10 * BasisPointConstants.ONE_PERCENT_BPS;

    // --- Immutables ---

    /// @notice Address of the associated vault
    IDPoolVaultLP public immutable VAULT;

    /// @notice Address of the DEX pool
    ICurveStableSwapNG public immutable POOL;

    // --- State variables ---

    /// @notice Pool assets [asset0, asset1]
    address[2] public poolAssets;

    /// @notice Maximum allowed slippage in basis points
    uint256 public maxSlippageBps;

    /// @notice Mapping of whitelisted assets
    mapping(address => bool) public whitelistedAssets;

    /// @notice Array of whitelisted assets for enumeration
    address[] public supportedAssets;

    // --- Constructor ---

    /**
     * @notice Initialize the Curve periphery
     * @param _vault Address of the associated vault
     * @param _pool Address of the DEX pool
     * @param admin Address to grant admin role
     */
    constructor(address _vault, address _pool, address admin) {
        if (_vault == address(0)) revert ZeroAddress();
        if (_pool == address(0)) revert ZeroAddress();
        if (admin == address(0)) revert ZeroAddress();

        VAULT = IDPoolVaultLP(_vault);
        POOL = ICurveStableSwapNG(_pool);

        // Automatically query pool assets instead of manual configuration
        poolAssets[0] = POOL.coins(0);
        poolAssets[1] = POOL.coins(1);

        // Set default max slippage to 1%
        maxSlippageBps = BasisPointConstants.ONE_PERCENT_BPS;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // --- Core functions ---

    /// @inheritdoc IDPoolPeriphery
    function depositAsset(
        address asset,
        uint256 amount,
        address receiver,
        uint256 minShares,
        uint256 maxSlippage
    ) external nonReentrant returns (uint256 shares) {
        if (!whitelistedAssets[asset]) {
            revert AssetNotWhitelisted();
        }
        if (maxSlippage > maxSlippageBps) {
            revert ExcessiveSlippage();
        }

        // Pull asset from user
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        // Get asset index in pool
        uint256 assetIndex = _getAssetIndex(asset);

        // Prepare amounts array for Curve
        uint256[] memory amounts = new uint256[](2);
        amounts[assetIndex] = amount;

        // Calculate minimum LP tokens to receive
        uint256 expectedLP = POOL.calc_token_amount(amounts, true);
        uint256 minLP = Math.mulDiv(
            expectedLP,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - maxSlippage,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
        );

        // Approve asset to curve pool
        IERC20(asset).forceApprove(address(POOL), amount);

        // Add liquidity to get LP tokens
        uint256 lpAmount = POOL.add_liquidity(amounts, minLP);

        // Approve LP tokens to vault
        IERC20(VAULT.lpToken()).forceApprove(address(VAULT), lpAmount);

        // Deposit LP tokens to vault
        shares = VAULT.deposit(lpAmount, receiver);

        // Verify minimum shares received
        if (shares < minShares) {
            revert InsufficientOutput();
        }

        emit AssetDeposited(receiver, asset, amount, lpAmount, shares);
    }

    /// @inheritdoc IDPoolPeriphery
    function withdrawToAsset(
        uint256 shares,
        address asset,
        address receiver,
        address owner,
        uint256 minAmount,
        uint256 maxSlippage
    ) external nonReentrant returns (uint256 assetAmount) {
        if (!whitelistedAssets[asset]) {
            revert AssetNotWhitelisted();
        }
        if (maxSlippage > maxSlippageBps) {
            revert ExcessiveSlippage();
        }

        // Get asset index in pool
        uint256 assetIndex = _getAssetIndex(asset);

        // Preview LP amount we'll get from vault
        uint256 lpAmount = VAULT.previewRedeem(shares);

        // Calculate minimum asset amount considering slippage
        uint256 expectedAsset = POOL.calc_withdraw_one_coin(
            lpAmount,
            int128(uint128(assetIndex))
        );
        uint256 minAssetFromSlippage = Math.mulDiv(
            expectedAsset,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - maxSlippage,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
        );

        // Use the higher of user's minAmount or slippage-adjusted minimum
        uint256 finalMinAmount = minAmount > minAssetFromSlippage
            ? minAmount
            : minAssetFromSlippage;

        // Withdraw from vault to get LP tokens
        uint256 actualLPAmount = VAULT.redeem(shares, address(this), owner);

        // Remove liquidity from Curve to get asset
        assetAmount = POOL.remove_liquidity_one_coin(
            actualLPAmount,
            int128(uint128(assetIndex)),
            finalMinAmount
        );

        // Transfer asset to receiver
        IERC20(asset).safeTransfer(receiver, assetAmount);

        emit AssetWithdrawn(
            receiver,
            asset,
            shares,
            actualLPAmount,
            assetAmount
        );
    }

    // --- Preview functions ---

    /// @inheritdoc IDPoolPeriphery
    function previewDepositAsset(
        address asset,
        uint256 amount
    ) external view returns (uint256 shares) {
        if (!whitelistedAssets[asset]) {
            revert AssetNotWhitelisted();
        }

        // Get asset index
        uint256 assetIndex = _getAssetIndex(asset);

        // Prepare amounts array
        uint256[] memory amounts = new uint256[](2);
        amounts[assetIndex] = amount;

        // Calculate LP tokens that would be received
        uint256 lpAmount = POOL.calc_token_amount(amounts, true);

        // Calculate shares from vault
        return VAULT.previewDeposit(lpAmount);
    }

    /// @inheritdoc IDPoolPeriphery
    function previewWithdrawToAsset(
        uint256 shares,
        address asset
    ) external view returns (uint256 assetAmount) {
        if (!whitelistedAssets[asset]) {
            revert AssetNotWhitelisted();
        }

        // Get asset index
        uint256 assetIndex = _getAssetIndex(asset);

        // Preview LP amount from vault
        uint256 lpAmount = VAULT.previewRedeem(shares);

        // Calculate asset amount from LP
        return
            POOL.calc_withdraw_one_coin(lpAmount, int128(uint128(assetIndex)));
    }

    // --- View functions ---

    /// @inheritdoc IDPoolPeriphery
    function vault() external view returns (address) {
        return address(VAULT);
    }

    /// @inheritdoc IDPoolPeriphery
    function isAssetWhitelisted(address asset) external view returns (bool) {
        return whitelistedAssets[asset];
    }

    /// @inheritdoc IDPoolPeriphery
    function getSupportedAssets() external view returns (address[] memory) {
        return supportedAssets;
    }

    /**
     * @notice Get the DEX pool address
     * @return Address of the DEX pool
     */
    function pool() external view override returns (address) {
        return address(POOL);
    }

    /**
     * @notice Get pool assets
     * @return Array of pool asset addresses
     */
    function getPoolAssets() external view returns (address[2] memory) {
        return poolAssets;
    }

    // --- Admin functions ---

    /// @inheritdoc IDPoolPeriphery
    function addWhitelistedAsset(
        address asset
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (whitelistedAssets[asset]) {
            return; // Already whitelisted
        }

        // Verify asset is in the pool
        _getAssetIndex(asset); // Will revert if not found

        whitelistedAssets[asset] = true;
        supportedAssets.push(asset);

        emit AssetWhitelisted(asset);
    }

    /// @inheritdoc IDPoolPeriphery
    function removeWhitelistedAsset(
        address asset
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!whitelistedAssets[asset]) {
            return; // Not whitelisted
        }

        whitelistedAssets[asset] = false;

        // Remove from supportedAssets array
        for (uint256 i = 0; i < supportedAssets.length; i++) {
            if (supportedAssets[i] == asset) {
                supportedAssets[i] = supportedAssets[
                    supportedAssets.length - 1
                ];
                supportedAssets.pop();
                break;
            }
        }

        emit AssetRemovedFromWhitelist(asset);
    }

    /// @inheritdoc IDPoolPeriphery
    function setMaxSlippage(
        uint256 newMaxSlippage
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newMaxSlippage > MAX_SLIPPAGE_BPS) {
            revert ExcessiveSlippage();
        }

        maxSlippageBps = newMaxSlippage;
        emit MaxSlippageUpdated(newMaxSlippage);
    }

    // --- Internal functions ---

    /**
     * @notice Get the index of an asset in the Curve pool
     * @param asset Address of the asset
     * @return Index of the asset (0 or 1)
     */
    function _getAssetIndex(address asset) internal view returns (uint256) {
        if (asset == poolAssets[0]) {
            return 0;
        } else if (asset == poolAssets[1]) {
            return 1;
        } else {
            revert InvalidAssetIndex();
        }
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
