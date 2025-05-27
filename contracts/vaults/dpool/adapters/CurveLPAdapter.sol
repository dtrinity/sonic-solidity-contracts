// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDPoolLPAdapter} from "../interfaces/IDPoolLPAdapter.sol";
import {ICurveStableSwapNG} from "../interfaces/CurveStableSwapNG.sol";

/**
 * @title CurveLPAdapter
 * @notice Implements IDPoolLPAdapter for Curve StableSwap LP tokens
 * @dev Converts base asset to/from Curve LP tokens, handles single-sided liquidity operations
 */
contract CurveLPAdapter is IDPoolLPAdapter {
    using SafeERC20 for IERC20;

    // --- Errors ---
    error ZeroAddress();
    error UnderlyingAssetNotInPool(
        address baseAsset,
        address coin0,
        address coin1
    );
    error SlippageExceeded(
        uint256 expected,
        uint256 received,
        uint256 minExpected
    );
    error LPTokenDoesNotIncreaseAfterDeposit(
        uint256 before,
        uint256 afterAmount
    );
    error InsufficientAssetReceived(uint256 expected, uint256 received);

    // --- State ---
    ICurveStableSwapNG public immutable curvePool;
    address public immutable lpToken;
    address public immutable baseAsset;
    address public immutable collateralVault;

    uint128 public immutable baseAssetIndex; // Index of base asset in Curve pool (0 or 1)
    uint128 public immutable otherAssetIndex; // Index of the other asset in pool (1 or 0)

    // --- Constructor ---
    constructor(
        address _curvePool,
        address _baseAsset,
        address _collateralVault
    ) {
        if (
            _curvePool == address(0) ||
            _baseAsset == address(0) ||
            _collateralVault == address(0)
        ) {
            revert ZeroAddress();
        }

        ICurveStableSwapNG pool = ICurveStableSwapNG(_curvePool);

        // Validate pool has required coins
        require(pool.coins(0) != address(0), "No 1st coin in pool");
        require(pool.coins(1) != address(0), "No 2nd coin in pool");

        // Determine base asset index in the pool
        (baseAssetIndex, otherAssetIndex) = _getBaseAssetIndex(
            address(pool.coins(0)),
            address(pool.coins(1)),
            _baseAsset
        );

        curvePool = pool;
        lpToken = _curvePool; // In Curve, the pool contract itself is the LP token
        baseAsset = _baseAsset;
        collateralVault = _collateralVault;
    }

    // --- External Functions (IDPoolLPAdapter Interface) ---

    /**
     * @inheritdoc IDPoolLPAdapter
     */
    function convertToLP(
        uint256 baseAssetAmount,
        uint256 minLPAmount
    ) external override returns (address, uint256) {
        // Pull base asset from caller
        IERC20(baseAsset).safeTransferFrom(
            msg.sender,
            address(this),
            baseAssetAmount
        );

        uint256 lpBalanceBefore = curvePool.balanceOf(address(this));

        // Create amounts array for add_liquidity with only the base asset
        uint256[] memory amounts = new uint256[](2);
        if (baseAssetIndex == 0) {
            amounts[0] = baseAssetAmount;
            amounts[1] = 0;
        } else {
            amounts[0] = 0;
            amounts[1] = baseAssetAmount;
        }

        // Approve Curve pool to spend base asset
        IERC20(baseAsset).approve(address(curvePool), baseAssetAmount);

        // Add liquidity to pool
        curvePool.add_liquidity(amounts, minLPAmount);

        uint256 lpBalanceAfter = curvePool.balanceOf(address(this));
        uint256 lpReceived = lpBalanceAfter - lpBalanceBefore;

        // Validate LP tokens were received
        if (lpReceived == 0) {
            revert LPTokenDoesNotIncreaseAfterDeposit(
                lpBalanceBefore,
                lpBalanceAfter
            );
        }

        // Send LP tokens to collateral vault
        IERC20(lpToken).safeTransfer(collateralVault, lpReceived);

        return (lpToken, lpReceived);
    }

    /**
     * @inheritdoc IDPoolLPAdapter
     */
    function convertFromLP(
        uint256 lpAmount,
        uint256 minBaseAssetAmount
    ) external override returns (uint256) {
        // Pull LP tokens from caller
        IERC20(lpToken).safeTransferFrom(msg.sender, address(this), lpAmount);

        uint256 baseAssetBalanceBefore = IERC20(baseAsset).balanceOf(
            address(this)
        );

        // Approve Curve pool to spend LP tokens
        IERC20(lpToken).approve(address(curvePool), lpAmount);

        // Remove liquidity for single coin (base asset)
        curvePool.remove_liquidity_one_coin(
            lpAmount,
            int128(uint128(baseAssetIndex)),
            minBaseAssetAmount
        );

        uint256 baseAssetBalanceAfter = IERC20(baseAsset).balanceOf(
            address(this)
        );
        uint256 baseAssetReceived = baseAssetBalanceAfter -
            baseAssetBalanceBefore;

        // Validate minimum amount received
        if (baseAssetReceived < minBaseAssetAmount) {
            revert InsufficientAssetReceived(
                minBaseAssetAmount,
                baseAssetReceived
            );
        }

        // Send base asset to caller
        IERC20(baseAsset).safeTransfer(msg.sender, baseAssetReceived);

        return baseAssetReceived;
    }

    /**
     * @inheritdoc IDPoolLPAdapter
     */
    function previewConvertToLP(
        uint256 baseAssetAmount
    ) external view override returns (address, uint256) {
        // Create amounts array for calculation
        uint256[] memory amounts = new uint256[](2);
        if (baseAssetIndex == 0) {
            amounts[0] = baseAssetAmount;
            amounts[1] = 0;
        } else {
            amounts[0] = 0;
            amounts[1] = baseAssetAmount;
        }

        // Calculate expected LP tokens
        uint256 expectedLPAmount = curvePool.calc_token_amount(amounts, true);

        return (lpToken, expectedLPAmount);
    }

    /**
     * @inheritdoc IDPoolLPAdapter
     */
    function previewConvertFromLP(
        uint256 lpAmount
    ) external view override returns (uint256) {
        // Calculate expected base asset amount
        return
            curvePool.calc_withdraw_one_coin(
                lpAmount,
                int128(uint128(baseAssetIndex))
            );
    }

    /**
     * @inheritdoc IDPoolLPAdapter
     */
    function lpValueInBaseAsset(
        address _lpToken,
        uint256 lpAmount
    ) external view override returns (uint256) {
        require(_lpToken == lpToken, "Invalid LP token");

        if (lpAmount == 0) {
            return 0;
        }

        // Calculate value using Curve's calc_withdraw_one_coin
        return
            curvePool.calc_withdraw_one_coin(
                lpAmount,
                int128(uint128(baseAssetIndex))
            );
    }

    // --- Internal Functions ---

    /**
     * @notice Determines the index of the base asset in the Curve pool
     * @param coin0 Address of first coin in pool
     * @param coin1 Address of second coin in pool
     * @param _baseAsset Address of the base asset
     * @return baseIndex Index of base asset (0 or 1)
     * @return otherIndex Index of other asset (1 or 0)
     */
    function _getBaseAssetIndex(
        address coin0,
        address coin1,
        address _baseAsset
    ) private pure returns (uint128 baseIndex, uint128 otherIndex) {
        if (coin0 == _baseAsset) {
            return (0, 1);
        } else if (coin1 == _baseAsset) {
            return (1, 0);
        }
        revert UnderlyingAssetNotInPool(_baseAsset, coin0, coin1);
    }
}
