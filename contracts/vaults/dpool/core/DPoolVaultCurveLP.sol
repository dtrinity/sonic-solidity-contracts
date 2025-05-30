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

/**
 * @title DPoolVaultCurveLP
 * @author dTRINITY Protocol  
 * @notice Curve LP vault implementation that values LP tokens in base asset terms
 * @dev Uses Curve's calc_withdraw_one_coin for accurate pricing without oracle dependencies
 */
contract DPoolVaultCurveLP is DPoolVaultLP {
    using SafeERC20 for IERC20;

    // --- Immutables ---

    /// @notice Address of the DEX pool for LP token interactions
    ICurveStableSwapNG public immutable POOL;

    /// @notice Index of base asset in the DEX pool
    int128 public immutable BASE_ASSET_INDEX;

    // --- Constructor ---

    /**
     * @notice Initialize the Curve LP vault
     * @param baseAsset Address of the base asset for valuation
     * @param lpToken Address of the Curve LP token
     * @param _pool Address of the DEX pool
     * @param name Vault token name
     * @param symbol Vault token symbol  
     * @param admin Address to grant admin role
     */
    constructor(
        address baseAsset,
        address lpToken,
        address _pool,
        string memory name,
        string memory symbol,
        address admin
    ) DPoolVaultLP(baseAsset, lpToken, name, symbol, admin) {
        if (_pool == address(0)) revert("Invalid pool");

        POOL = ICurveStableSwapNG(_pool);

        // Query pool to find which index corresponds to the base asset
        address asset0 = POOL.coins(0);
        address asset1 = POOL.coins(1);
        
        int128 calculatedIndex;
        if (baseAsset == asset0) {
            calculatedIndex = 0;
        } else if (baseAsset == asset1) {
            calculatedIndex = 1;
        } else {
            revert("Base asset not found in pool");
        }
        
        BASE_ASSET_INDEX = calculatedIndex;
    }

    // --- Asset valuation ---

    /**
     * @notice Calculate total assets managed by the vault in base asset terms
     * @dev Uses Curve's calc_withdraw_one_coin for accurate LP token valuation
     * @return Total assets in base asset terms
     */
    function totalAssets() public view override(ERC4626, IERC4626) returns (uint256) {
        uint256 lpBalance = IERC20(LP_TOKEN).balanceOf(address(this));
        if (lpBalance == 0) {
            return 0;
        }

        // Use Curve's calc_withdraw_one_coin to get base asset value
        return POOL.calc_withdraw_one_coin(lpBalance, BASE_ASSET_INDEX);
    }

    // --- View functions ---

    /**
     * @notice Get the DEX pool address
     * @return Address of the DEX pool
     */
    function pool() external view override returns (address) {
        return address(POOL);
    }

    /**
     * @notice Get the base asset index in the DEX pool
     * @return Index of the base asset
     */
    function baseAssetIndex() external view returns (int128) {
        return BASE_ASSET_INDEX;
    }

    /**
     * @notice Preview base asset value for a given amount of LP tokens
     * @param lpAmount Amount of LP tokens
     * @return Base asset value
     */
    function previewLPValue(uint256 lpAmount) external view override returns (uint256) {
        if (lpAmount == 0) {
            return 0;
        }
        return POOL.calc_withdraw_one_coin(lpAmount, BASE_ASSET_INDEX);
    }
} 