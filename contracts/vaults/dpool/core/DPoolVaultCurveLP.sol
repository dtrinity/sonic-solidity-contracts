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

import "./DPoolVaultLP.sol";
import "./interfaces/ICurveStableSwapNG.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./interfaces/IDPoolVaultLP.sol";

/**
 * @title DPoolVaultCurveLP
 * @author dTRINITY Protocol
 * @notice Curve-specific dPOOL vault implementation
 * @dev Handles Curve LP tokens as the primary asset, uses Curve's calc_withdraw_one_coin for external valuation only
 */
contract DPoolVaultCurveLP is DPoolVaultLP {
    // --- Errors ---

    /// @notice Thrown when base asset is not found in the Curve pool
    error BaseAssetNotFoundInPool();

    // --- Immutables ---

    /// @notice Address of the Curve pool (same as LP token for Curve)
    address public immutable POOL;

    /// @notice Index of the base asset in the Curve pool (0 or 1) - used only for previewLPValue
    int128 public immutable BASE_ASSET_INDEX;

    // --- Constructor ---

    /**
     * @notice Initialize the Curve vault
     * @param baseAsset Address of the base asset for external valuation (used only in previewLPValue)
     * @param _lpToken Address of the Curve LP token (same as pool address)
     * @param _pool Address of the Curve pool (same as LP token for Curve)
     * @param name Vault token name
     * @param symbol Vault token symbol
     * @param admin Address to grant admin role
     */
    constructor(
        address baseAsset,
        address _lpToken,
        address _pool,
        string memory name,
        string memory symbol,
        address admin
    ) DPoolVaultLP(_lpToken, name, symbol, admin) {
        if (_pool == address(0)) revert ZeroAddress();

        POOL = _pool;

        // Auto-determine base asset index in pool for external valuation
        ICurveStableSwapNG curvePool = ICurveStableSwapNG(_pool);
        address coin0 = curvePool.coins(0);
        address coin1 = curvePool.coins(1);

        int128 calculatedIndex;
        if (baseAsset == coin0) {
            calculatedIndex = 0;
        } else if (baseAsset == coin1) {
            calculatedIndex = 1;
        } else {
            revert BaseAssetNotFoundInPool();
        }

        BASE_ASSET_INDEX = calculatedIndex;
    }

    // --- View functions ---

    /**
     * @notice Get the DEX pool address
     * @return Address of the DEX pool
     */
    function pool() external view override returns (address) {
        return POOL;
    }

    /**
     * @notice Get the base asset index in the Curve pool
     * @return Index of the base asset
     */
    function baseAssetIndex() external view returns (uint256) {
        return uint256(int256(BASE_ASSET_INDEX));
    }

    /**
     * @notice Preview base asset value for a given amount of LP tokens
     * @dev This is an auxiliary function for external valuation, not used in core ERC4626 mechanics
     * @param lpAmount Amount of LP tokens
     * @return Base asset value
     */
    function previewLPValue(uint256 lpAmount) external view override returns (uint256) {
        if (lpAmount == 0) {
            return 0;
        }
        return ICurveStableSwapNG(POOL).calc_withdraw_one_coin(lpAmount, BASE_ASSET_INDEX);
    }
}
