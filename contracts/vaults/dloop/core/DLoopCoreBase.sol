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

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { ERC4626, ERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { Erc20Helper } from "contracts/common/Erc20Helper.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RescuableVault } from "contracts/common/RescuableVault.sol";
import { DLoopCoreLogic } from "./DLoopCoreLogic.sol";
import { Compare } from "contracts/common/Compare.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title DLoopCoreBase
 * @dev A contract that executes leveraged operations on a lending pool using a collateral token and a debt token
 *      - A leveraged position is created by supplying a collateral token to the lending pool and borrowing a debt token
 *      - The leverage ratio will be changed if the collateral and debt values are changed (due to price changes)
 *      - The leverage can be increased by supplying more collateral token or decreasing the debt token
 *      - The leverage can be decreased by withdrawing collateral token or increasing the debt token
 *      - In order to keep the vault balanced, user can call increaseLeverage or decreaseLeverage to increase or decrease the leverage
 *        when it is away from the target leverage
 *      - There is a subsidy for the caller when increasing the leverage.
 *      - The withdrawal fee is being applied when calling redeem and withdraw. The fee is not being transferred to a fee receiver, instead
 *        it is being shared to the current shares holders. It means, the vault of the vault's share will be a bit increased after a user's withdrawal.
 *      - The withdrawal fee is not applied for decreaseLeverage(), as this operation is not a vault withdrawal, instead, it repay and withdraw
 *        from the underlying pool to rebalance the vault position, not vault's shares are being burned.
 *
 * @notice Withdrawal fee retention (no external transfers)
 * @dev The withdrawal fee is retained by the vault and is not sent to any external recipient.
 *      Users receive net assets after fee; the difference remains in the vault and accrues to remaining shares.
 *      - previewWithdraw treats `assets` as the desired net and converts to gross using:
 *        gross = assets * ONE_HUNDRED_PERCENT_BPS / (ONE_HUNDRED_PERCENT_BPS - withdrawalFeeBps).
 *      - previewRedeem returns the net assets after applying the fee.
 *      - During _withdraw, only the net amount is transferred to `receiver`; the fee stays in the vault balance.
 */
abstract contract DLoopCoreBase is ERC4626, Ownable, ReentrancyGuard, RescuableVault {
    using SafeERC20 for ERC20;

    /* Core state */

    uint32 public lowerBoundTargetLeverageBps;
    uint32 public upperBoundTargetLeverageBps;
    uint256 public maxSubsidyBps;
    uint256 public minDeviationBps;
    uint256 public withdrawalFeeBps;

    /* Constants */

    uint32 public immutable targetLeverageBps; // ie. 30000 = 300% in basis points, means 3x leverage
    ERC20 public immutable collateralToken;
    ERC20 public immutable debtToken;

    uint256 public constant BALANCE_DIFF_TOLERANCE = 1;
    uint256 public constant LEVERAGE_DIFF_TOLERANCE = 1;
    uint256 public constant MAX_WITHDRAWAL_FEE_BPS = 10 * BasisPointConstants.ONE_PERCENT_BPS; // 100%

    /* Events */

    event IncreaseLeverage(
        address indexed caller,
        uint256 inputCollateralTokenAmount,
        uint256 minReceivedDebtTokenAmount,
        uint256 suppliedCollateralTokenAmount,
        uint256 borrowedDebtTokenAmount
    );

    event DecreaseLeverage(
        address indexed caller,
        uint256 inputDebtTokenAmount,
        uint256 minReceivedCollateralTokenAmount,
        uint256 repaidDebtTokenAmount,
        uint256 withdrawnCollateralTokenAmount
    );

    event MaxSubsidyBpsSet(uint256 oldMaxSubsidyBps, uint256 newMaxSubsidyBps);

    event MinDeviationBpsSet(uint256 oldMinDeviationBps, uint256 newMinDeviationBps);

    event LeverageBoundsSet(uint32 lowerBoundTargetLeverageBps, uint32 upperBoundTargetLeverageBps);

    event WithdrawalFeeBpsSet(uint256 oldWithdrawalFeeBps, uint256 newWithdrawalFeeBps);

    event LeftoverCollateralTokensTransferred(address indexed token, uint256 amount, address indexed receiver);

    event LeftoverDebtTokensTransferred(address indexed token, uint256 amount, address indexed receiver);

    /* Errors */

    error TooImbalanced(
        uint256 currentLeverageBps,
        uint256 lowerBoundTargetLeverageBps,
        uint256 upperBoundTargetLeverageBps
    );
    error InsufficientAllowanceOfDebtAssetToRepay(
        address owner,
        address spender,
        address debtAsset,
        uint256 requiredAllowance
    );
    error InsufficientAllowanceOfCollateralAssetToSupply(
        address owner,
        address spender,
        address collateralAsset,
        uint256 requiredAllowance
    );
    error DecreaseLeverageOutOfRange(
        uint256 newLeverageBps,
        uint256 targetLeverageBps, // lower bound
        uint256 currentLeverageBps // upper bound
    );
    error IncreaseLeverageOutOfRange(
        uint256 newLeverageBps,
        uint256 targetLeverageBps, // upper bound
        uint256 currentLeverageBps // lower bound
    );
    error TokenBalanceNotDecreasedAfterRepay(
        address token,
        uint256 tokenBalanceBefore,
        uint256 tokenBalanceAfter,
        uint256 expectedTokenBalance
    );
    error UnexpectedRepayAmountToPool(
        address token,
        uint256 tokenBalanceBefore,
        uint256 tokenBalanceAfter,
        uint256 expectedTokenBalance
    );
    error TokenBalanceNotDecreasedAfterSupply(
        address token,
        uint256 tokenBalanceBefore,
        uint256 tokenBalanceAfter,
        uint256 expectedTokenBalance
    );
    error UnexpectedSupplyAmountToPool(
        address token,
        uint256 tokenBalanceBefore,
        uint256 tokenBalanceAfter,
        uint256 expectedTokenBalance
    );
    error TokenBalanceNotIncreasedAfterBorrow(
        address token,
        uint256 tokenBalanceBefore,
        uint256 tokenBalanceAfter,
        uint256 expectedTokenBalance
    );
    error UnexpectedBorrowAmountFromPool(
        address token,
        uint256 borrowedAmountBefore,
        uint256 borrowedAmountAfter,
        uint256 expectedBorrowedAmount
    );
    error TokenBalanceNotIncreasedAfterWithdraw(
        address token,
        uint256 tokenBalanceBefore,
        uint256 tokenBalanceAfter,
        uint256 expectedTokenBalance
    );
    error UnexpectedWithdrawAmountFromPool(
        address token,
        uint256 withdrawableAmountBefore,
        uint256 withdrawableAmountAfter,
        uint256 expectedWithdrawableAmount
    );
    error InvalidLeverageBounds(uint256 lowerBound, uint256 targetLeverage, uint256 upperBound);
    error AssetPriceIsZero(address asset);
    error LeverageExceedsTarget(uint256 currentLeverageBps, uint256 targetLeverageBps);
    error LeverageBelowTarget(uint256 currentLeverageBps, uint256 targetLeverageBps);
    error IncreaseLeverageReceiveLessThanMinAmount(uint256 receivedDebtTokenAmount, uint256 minReceivedDebtTokenAmount);
    error DecreaseLeverageReceiveLessThanMinAmount(
        uint256 receivedCollateralTokenAmount,
        uint256 minReceivedCollateralTokenAmount
    );
    error ZeroShares();
    error WithdrawalFeeIsGreaterThanMaxFee(uint256 withdrawalFeeBps, uint256 maxWithdrawalFeeBps);
    error InvalidTargetLeverage(uint256 targetLeverageBps);
    error InvalidCollateralToken(address token);
    error InvalidDebtToken(address token);

    /**
     * @dev Constructor for the DLoopCore contract
     * @param _name Name of the vault token
     * @param _symbol Symbol of the vault token
     * @param _collateralToken Address of the collateral token
     * @param _debtToken Address of the debt token
     * @param _targetLeverageBps Target leverage in basis points
     * @param _lowerBoundTargetLeverageBps Lower bound of target leverage in basis points
     * @param _upperBoundTargetLeverageBps Upper bound of target leverage in basis points
     * @param _maxSubsidyBps Maximum subsidy in basis points
     * @param _minDeviationBps Minimum deviation of leverage from the target leverage in basis points
     * @param _withdrawalFeeBps Initial withdrawal fee in basis points
     */
    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _collateralToken,
        ERC20 _debtToken,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps,
        uint256 _minDeviationBps,
        uint256 _withdrawalFeeBps
    ) ERC20(_name, _symbol) ERC4626(_collateralToken) Ownable(msg.sender) {
        debtToken = _debtToken;
        collateralToken = _collateralToken;

        if (_targetLeverageBps < BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert InvalidTargetLeverage(_targetLeverageBps);
        }

        if (_lowerBoundTargetLeverageBps >= _targetLeverageBps || _targetLeverageBps >= _upperBoundTargetLeverageBps) {
            revert InvalidLeverageBounds(
                _lowerBoundTargetLeverageBps,
                _targetLeverageBps,
                _upperBoundTargetLeverageBps
            );
        }

        // Make sure collateral token is ERC-20
        if (!Erc20Helper.isERC20(address(_collateralToken))) {
            revert InvalidCollateralToken(address(_collateralToken));
        }

        // Make sure debt token is ERC-20
        if (!Erc20Helper.isERC20(address(_debtToken))) {
            revert InvalidDebtToken(address(_debtToken));
        }

        targetLeverageBps = _targetLeverageBps;
        lowerBoundTargetLeverageBps = _lowerBoundTargetLeverageBps;
        upperBoundTargetLeverageBps = _upperBoundTargetLeverageBps;
        maxSubsidyBps = _maxSubsidyBps;
        minDeviationBps = _minDeviationBps;
        withdrawalFeeBps = _withdrawalFeeBps;
    }

    /* Virtual Methods - Required to be implemented by derived contracts */

    /**
     * @dev Gets the total collateral and debt of a user in base currency
     * @param user Address of the user
     * @return totalCollateralBase Total collateral in base currency
     * @return totalDebtBase Total debt in base currency
     */
    function getTotalCollateralAndDebtOfUserInBase(
        address user
    ) public view virtual returns (uint256 totalCollateralBase, uint256 totalDebtBase) {
        // Collateral side: balance of the aToken corresponding to collateralToken
        uint256 collateralBalanceInTokenAmount = getCollateralValueInTokenAmount(address(collateralToken), user);
        totalCollateralBase = convertFromTokenAmountToBaseCurrency(
            collateralBalanceInTokenAmount,
            address(collateralToken)
        );

        // Debt side: sum of variable + stable debt token balances corresponding to debtToken
        uint256 debtBalanceInTokenAmount = getDebtValueInTokenAmount(address(debtToken), user);
        totalDebtBase = convertFromTokenAmountToBaseCurrency(debtBalanceInTokenAmount, address(debtToken));
        return (totalCollateralBase, totalDebtBase);
    }

    /**
     * @dev Get the collateral value in token amount in the underlying pool
     * @param token The address of the token
     * @param user The address of the user
     * @return collateralTokenAmount The collateral token amount
     */
    function getCollateralValueInTokenAmount(
        address token,
        address user
    ) public view virtual returns (uint256 collateralTokenAmount);

    /**
     * @dev Get the debt value in token amount in the underlying pool
     * @param token The address of the token
     * @param user The address of the user
     * @return debtTokenAmount The debt token amount
     */
    function getDebtValueInTokenAmount(
        address token,
        address user
    ) public view virtual returns (uint256 debtTokenAmount);

    /**
     * @dev Gets the additional rescue tokens
     *      - As the getRestrictedRescueTokens function is very critical and we do not
     *        want to override it in the derived contracts, we use this function to
     *        get the additional rescue tokens
     * @return address[] Additional rescue tokens
     */
    function _getAdditionalRescueTokensImplementation() internal view virtual returns (address[] memory);

    /**
     * @dev Gets the asset price from the oracle
     * @param asset Address of the asset
     * @return uint256 Price of the asset
     */
    function _getAssetPriceFromOracleImplementation(address asset) internal view virtual returns (uint256);

    /**
     * @dev Supply tokens to the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to supply
     * @param onBehalfOf Address to supply on behalf of
     */
    function _supplyToPoolImplementation(address token, uint256 amount, address onBehalfOf) internal virtual;

    /**
     * @dev Borrow tokens from the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to borrow
     * @param onBehalfOf Address to borrow on behalf of
     */
    function _borrowFromPoolImplementation(address token, uint256 amount, address onBehalfOf) internal virtual;

    /**
     * @dev Repay debt to the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to repay
     * @param onBehalfOf Address to repay on behalf of
     */
    function _repayDebtToPoolImplementation(address token, uint256 amount, address onBehalfOf) internal virtual;

    /**
     * @dev Withdraw tokens from the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to withdraw
     * @param onBehalfOf Address to withdraw on behalf of
     */
    function _withdrawFromPoolImplementation(address token, uint256 amount, address onBehalfOf) internal virtual;

    /* Wrapper Functions */

    /**
     * @dev Supply tokens to the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to supply
     * @param onBehalfOf Address to supply on behalf of
     * @return uint256 The amount of tokens supplied
     */
    function _supplyToPool(address token, uint256 amount, address onBehalfOf) internal returns (uint256) {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeSupply = ERC20(token).balanceOf(onBehalfOf);

        _supplyToPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterSupply = ERC20(token).balanceOf(onBehalfOf);

        Compare.BalanceCheckResult memory check = Compare.checkBalanceDelta(
            tokenBalanceBeforeSupply,
            tokenBalanceAfterSupply,
            amount,
            BALANCE_DIFF_TOLERANCE,
            Compare.BalanceDirection.Decrease
        );
        if (!check.directionOk) {
            revert TokenBalanceNotDecreasedAfterSupply(
                token,
                tokenBalanceBeforeSupply,
                tokenBalanceAfterSupply,
                amount
            );
        }
        if (!check.toleranceOk) {
            revert UnexpectedSupplyAmountToPool(token, tokenBalanceBeforeSupply, tokenBalanceAfterSupply, amount);
        }

        // Return the observed value to avoid the case when the actual amount is 1 wei different from the expected amount
        return check.observedDelta;
    }

    /**
     * @dev Borrow tokens from the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to borrow
     * @param onBehalfOf Address to borrow on behalf of
     * @return uint256 The amount of tokens borrowed
     */
    function _borrowFromPool(address token, uint256 amount, address onBehalfOf) internal returns (uint256) {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeBorrow = ERC20(token).balanceOf(onBehalfOf);

        _borrowFromPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterBorrow = ERC20(token).balanceOf(onBehalfOf);

        Compare.BalanceCheckResult memory check = Compare.checkBalanceDelta(
            tokenBalanceBeforeBorrow,
            tokenBalanceAfterBorrow,
            amount,
            BALANCE_DIFF_TOLERANCE,
            Compare.BalanceDirection.Increase
        );
        if (!check.directionOk) {
            revert TokenBalanceNotIncreasedAfterBorrow(
                token,
                tokenBalanceBeforeBorrow,
                tokenBalanceAfterBorrow,
                amount
            );
        }
        if (!check.toleranceOk) {
            revert UnexpectedBorrowAmountFromPool(token, tokenBalanceBeforeBorrow, tokenBalanceAfterBorrow, amount);
        }

        // Return the observed value to avoid the case when the actual amount is 1 wei different from the expected amount
        return check.observedDelta;
    }

    /**
     * @dev Repay debt to the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to repay
     * @param onBehalfOf Address to repay on behalf of
     * @return uint256 The amount of tokens repaid
     */
    function _repayDebtToPool(address token, uint256 amount, address onBehalfOf) internal returns (uint256) {
        // Get the debt position before repaying
        uint256 debtPositionBeforeRepay = getDebtValueInTokenAmount(token, onBehalfOf);

        // Cap the amount to repay to the debt position to avoid
        // later balance assertion
        amount = Math.min(amount, debtPositionBeforeRepay);

        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeRepay = ERC20(token).balanceOf(onBehalfOf);

        _repayDebtToPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterRepay = ERC20(token).balanceOf(onBehalfOf);

        Compare.BalanceCheckResult memory check = Compare.checkBalanceDelta(
            tokenBalanceBeforeRepay,
            tokenBalanceAfterRepay,
            amount,
            BALANCE_DIFF_TOLERANCE,
            Compare.BalanceDirection.Decrease
        );
        if (!check.directionOk) {
            revert TokenBalanceNotDecreasedAfterRepay(token, tokenBalanceBeforeRepay, tokenBalanceAfterRepay, amount);
        }
        if (!check.toleranceOk) {
            revert UnexpectedRepayAmountToPool(token, tokenBalanceBeforeRepay, tokenBalanceAfterRepay, amount);
        }

        // Return the observed value to avoid the case when the actual amount is 1 wei different from the expected amount
        return check.observedDelta;
    }

    /**
     * @dev Withdraw tokens from the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to withdraw
     * @param onBehalfOf Address to withdraw on behalf of
     * @return uint256 The amount of tokens withdrawn
     */
    function _withdrawFromPool(address token, uint256 amount, address onBehalfOf) internal returns (uint256) {
        // Get the collateral position before withdrawing
        uint256 collateralPositionBeforeWithdraw = getCollateralValueInTokenAmount(token, onBehalfOf);

        // Cap the amount to withdraw to the collateral position to avoid
        // later balance assertion
        amount = Math.min(amount, collateralPositionBeforeWithdraw);

        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeWithdraw = ERC20(token).balanceOf(onBehalfOf);

        _withdrawFromPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterWithdraw = ERC20(token).balanceOf(onBehalfOf);

        Compare.BalanceCheckResult memory check = Compare.checkBalanceDelta(
            tokenBalanceBeforeWithdraw,
            tokenBalanceAfterWithdraw,
            amount,
            BALANCE_DIFF_TOLERANCE,
            Compare.BalanceDirection.Increase
        );
        if (!check.directionOk) {
            revert TokenBalanceNotIncreasedAfterWithdraw(
                token,
                tokenBalanceBeforeWithdraw,
                tokenBalanceAfterWithdraw,
                amount
            );
        }
        if (!check.toleranceOk) {
            revert UnexpectedWithdrawAmountFromPool(
                token,
                tokenBalanceBeforeWithdraw,
                tokenBalanceAfterWithdraw,
                amount
            );
        }

        // Return the observed value to avoid the case when the actual amount is 1 wei different from the expected amount
        return check.observedDelta;
    }

    /* Safety */

    /**
     * @dev Gets the restricted rescue tokens
     * @return address[] Restricted rescue tokens
     */
    function getRestrictedRescueTokens() public view virtual override returns (address[] memory) {
        // Get the additional rescue tokens from the derived contract
        return _getAdditionalRescueTokensImplementation();
    }

    /* Helper Functions */

    /**
     * @dev Calculates the leveraged amount of the assets with the target leverage
     * @param assets Amount of assets
     * @return leveragedAssets Amount of leveraged assets
     */
    function getTargetLeveragedAssets(uint256 assets) public view returns (uint256) {
        return DLoopCoreLogic.getLeveragedAssetsWithLeverage(assets, targetLeverageBps);
    }

    /**
     * @dev Calculates the leveraged amount of the assets with the current leverage
     * @param assets Amount of assets
     * @return leveragedAssets Amount of leveraged assets
     */
    function getCurrentLeveragedAssets(uint256 assets) public view returns (uint256) {
        return DLoopCoreLogic.getLeveragedAssetsWithLeverage(assets, getCurrentLeverageBps());
    }

    /**
     * @dev Calculates the unleveraged amount of the assets with the target leverage
     * @param leveragedAssets Amount of leveraged assets
     * @return unleveragedAssets Amount of unleveraged assets
     */
    function getUnleveragedAssetsWithTargetLeverage(uint256 leveragedAssets) public view returns (uint256) {
        return DLoopCoreLogic.getUnleveragedAssetsWithLeverage(leveragedAssets, targetLeverageBps);
    }

    /**
     * @dev Calculates the unleveraged amount of the assets with the current leverage
     * @param leveragedAssets Amount of leveraged assets
     * @return unleveragedAssets Amount of unleveraged assets
     */
    function getUnleveragedAssetsWithCurrentLeverage(uint256 leveragedAssets) public view returns (uint256) {
        return DLoopCoreLogic.getUnleveragedAssetsWithLeverage(leveragedAssets, getCurrentLeverageBps());
    }

    /**
     * @dev Gets the asset price from the oracle
     * @param asset Address of the asset
     * @return uint256 Price of the asset
     */
    function getAssetPriceFromOracle(address asset) public view returns (uint256) {
        uint256 assetPrice = _getAssetPriceFromOracleImplementation(asset);

        // Sanity check
        if (assetPrice == 0) {
            revert AssetPriceIsZero(asset);
        }

        return assetPrice;
    }

    /**
     * @dev Converts an amount in base currency to the actual amount in the token
     * @param amountInBase Amount in base currency
     * @param token Address of the token
     * @return amountInToken Amount in the token
     */
    function convertFromBaseCurrencyToToken(uint256 amountInBase, address token) public view returns (uint256) {
        return
            DLoopCoreLogic.convertFromBaseCurrencyToToken(
                amountInBase,
                ERC20(token).decimals(),
                getAssetPriceFromOracle(token)
            );
    }

    /**
     * @dev Converts an amount in the token to the actual amount in base currency
     * @param amountInToken Amount in the token
     * @param token Address of the token
     * @return amountInBase Amount in base currency
     */
    function convertFromTokenAmountToBaseCurrency(uint256 amountInToken, address token) public view returns (uint256) {
        return
            DLoopCoreLogic.convertFromTokenAmountToBaseCurrency(
                amountInToken,
                ERC20(token).decimals(),
                getAssetPriceFromOracle(token)
            );
    }

    /**
     * @dev Override of totalAssets from ERC4626
     * @return uint256 Total assets in the vault
     */
    function totalAssets() public view virtual override returns (uint256) {
        // We override this function to return the total assets in the vault
        // with respect to the position in the lending pool
        // The dLend interest will be distributed to the dToken
        (uint256 totalCollateralBase, ) = getTotalCollateralAndDebtOfUserInBase(address(this));
        // The price decimals is cancelled out in the division (as the amount and price are in the same unit)
        return convertFromBaseCurrencyToToken(totalCollateralBase, address(collateralToken));
    }

    /* Safety */

    /**
     * @dev Returns whether the current leverage is too imbalanced
     * @return bool True if leverage is too imbalanced, false otherwise
     */
    function isTooImbalanced() public view returns (bool) {
        return
            DLoopCoreLogic.isTooImbalanced(
                getCurrentLeverageBps(),
                lowerBoundTargetLeverageBps,
                upperBoundTargetLeverageBps
            );
    }

    /* Deposit and Mint */

    /**
     * @dev Deposits assets into the vault
     *      - It will send the borrowed debt token and the minted shares to the receiver
     *      - The minted shares represent the position of the supplied collateral assets in the lending pool
     * @param caller Address of the caller
     * @param receiver Address to receive the minted shares
     * @param assets Amount of assets to deposit
     * @param shares Amount of shares to mint
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override nonReentrant {
        if (shares == 0) {
            revert ZeroShares();
        }
        /**
         * Example of how this function works:
         *
         * Suppose that the target leverage is 3x, and the baseLTVAsCollateral is 70%
         * - The collateral token is WETH
         * - The debt here is dUSD
         * - The current collateral token balance is 0 WETH
         * - The current debt token balance is 0 dUSD
         * - The current shares supply is 0
         * - Assume that the price of WETH is 2000 dUSD
         *
         * 1. User deposits 300 WETH
         * 2. The vault supplies 300 WETH to the lending pool
         * 3. The vault borrows 400,000 dUSD (300 * 2000 * 66.6666666%) from the lending pool
         *    - 66.666% is to keep the target leverage 3x
         * 4. The vault sends 400,000 dUSD to the receiver
         * 5. The vault mints 300 shares to the user (representing 300 WETH position in the lending pool)
         *
         * The current leverage is: (300 * 2000) / (300 * 2000 - 400,000) = 3x
         */

        // Make sure the current leverage is within the target range
        if (isTooImbalanced()) {
            revert TooImbalanced(getCurrentLeverageBps(), lowerBoundTargetLeverageBps, upperBoundTargetLeverageBps);
        }

        uint256 debtAssetBorrowed = _supplyAndBorrowFromPoolImplementation(caller, assets);

        // Transfer the debt asset to the receiver
        debtToken.safeTransfer(receiver, debtAssetBorrowed);

        // Mint the vault's shares to the depositor
        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    /**
     * @dev Handles the logic of supplying collateral token and borrowing debt token
     * @param caller Address of the caller
     * @param supplyAssetAmount Amount of assets to supply
     * @return borrowedDebtTokenAmount Amount of debt asset to borrow
     */
    function _supplyAndBorrowFromPoolImplementation(
        address caller,
        uint256 supplyAssetAmount // supply amount
    ) private returns (uint256 borrowedDebtTokenAmount) {
        // Get current leverage before transferring, supplying and borrowing
        // to avoid unexpected impact from the child contract implementation
        // IMPORTANT: this is the leverage before supplying
        uint256 currentLeverageBpsBeforeSupply = getCurrentLeverageBps();

        // If do not have enough allowance, revert with the error message
        // This is to early-revert with instruction in the error message
        if (collateralToken.allowance(caller, address(this)) < supplyAssetAmount) {
            revert InsufficientAllowanceOfCollateralAssetToSupply(
                caller,
                address(this),
                address(collateralToken),
                supplyAssetAmount
            );
        }

        // Transfer the assets to the vault (need the allowance before calling this function)
        collateralToken.safeTransferFrom(caller, address(this), supplyAssetAmount);

        // At this step, the fund from the depositor is already in the vault

        // In this case, the vault is user of the lending pool
        // So, we need to supply the collateral token to the pool on behalf of the vault
        // and then borrow the debt token from the pool on behalf of the vault

        // Supply the collateral token to the lending pool
        uint256 actualSupplyAssetAmount = _supplyToPool(
            address(collateralToken),
            supplyAssetAmount,
            address(this) // the vault is the supplier
        );

        // Get the amount of debt token to borrow that keeps the current leverage
        uint256 debtTokenAmountToBorrow = DLoopCoreLogic.getBorrowAmountThatKeepCurrentLeverage(
            actualSupplyAssetAmount,
            currentLeverageBpsBeforeSupply,
            targetLeverageBps,
            ERC20(collateralToken).decimals(),
            getAssetPriceFromOracle(address(collateralToken)),
            ERC20(debtToken).decimals(),
            getAssetPriceFromOracle(address(debtToken))
        );

        // Borrow the max amount of debt token
        borrowedDebtTokenAmount = _borrowFromPool(
            address(debtToken),
            debtTokenAmountToBorrow,
            address(this) // the vault is the borrower
        );

        // Transfer the unused collateral token to the caller
        if (actualSupplyAssetAmount < supplyAssetAmount - BALANCE_DIFF_TOLERANCE) {
            uint256 unusedCollateralTokenAmount = supplyAssetAmount - actualSupplyAssetAmount;
            collateralToken.safeTransfer(caller, unusedCollateralTokenAmount);
            emit LeftoverCollateralTokensTransferred(address(collateralToken), unusedCollateralTokenAmount, caller);
        }

        return borrowedDebtTokenAmount;
    }

    /* Withdraw and Redeem */

    /**
     * @dev Withdraws collateral assets from the vault
     *      - It requires to spend the debt token to repay the debt
     *      - It will send the withdrawn collateral assets to the receiver and burn the shares
     *      - The burned shares represent the position of the withdrawn assets in the lending pool
     *      - The shares and assets are now reflected the charged withdrawal fee, thus no need to apply withdrawal fee again
     * @param caller Address of the caller
     * @param receiver Address to receive the withdrawn assets
     * @param owner Address of the owner
     * @param assets Amount of assets to remove from the lending pool
     * @param shares Amount of shares to burn
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        /**
         * Example of how this function works:
         *
         * Suppose that the target leverage is 3x, and the baseLTVAsCollateral is 70%
         * - The collateral token is WETH
         * - The debt here is dUSD
         * - The current shares supply is 300
         * - The current leverage is 3x
         * - The current collateral token balance is 300 WETH
         * - The current debt token balance is 400,000 dUSD (300 * 2000 * 66.6666666%)
         * - Assume that the price of WETH is 2000 dUSD
         *
         * 1. User has 100 shares
         * 2. User wants to withdraw 100 WETH
         * 3. The vault burns 100 shares
         * 4. The vault transfers 133,333 dUSD (100 * 2000 * 66.6666666%) from the user to the vault
         *    - 66.6666% is to keep the target leverage 3x
         * 5. The vault repays 133,333 dUSD to the lending pool
         *    - The debt is now 266,667 dUSD (400,000 - 133,333)
         * 6. The vault withdraws 100 WETH from the lending pool
         *    - The collateral is now 200 WETH (300 - 100)
         * 7. The vault sends 100 WETH to the receiver
         *
         * The current leverage is: (200 * 2000) / (200 * 2000 - 266,667) = 3x
         */

        // Note that we need the allowance before calling this function
        // - Allowance for the message sender to spend the shares on behalf of the owner
        // - Allowance for the vault to burn the shares

        // If the owner is not the caller, then we need to spend the allowance
        // so that the caller can spend the shares on behalf of the owner
        if (owner != caller) {
            _spendAllowance(owner, caller, shares);
        }

        // Burn the shares
        _burn(owner, shares);

        // Make sure the current leverage is within the target range
        if (isTooImbalanced()) {
            revert TooImbalanced(getCurrentLeverageBps(), lowerBoundTargetLeverageBps, upperBoundTargetLeverageBps);
        }

        // Withdraw the collateral from the lending pool
        // After this step, the _withdrawFromPool wrapper function will also assert that
        // the withdrawn amount is exactly the amount requested.
        (uint256 withdrawnCollateralTokenAmount, ) = _repayDebtAndWithdrawFromPoolImplementation(caller, assets);

        // Transfer the net asset to the receiver
        collateralToken.safeTransfer(receiver, withdrawnCollateralTokenAmount);

        // Emit ERC4626 Withdraw with amount actually sent
        emit Withdraw(caller, receiver, owner, withdrawnCollateralTokenAmount, shares);
    }

    /**
     * @dev Handles the logic for repaying debt and withdrawing collateral from the pool
     *      - It calculates the required debt token to repay to keep the current leverage
     *        given the expected withdraw amount
     *      - Then performs the actual repay and withdraw
     * @param caller Address of the caller
     * @param collateralTokenToWithdraw The amount of collateral token to withdraw
     * @return withdrawnCollateralTokenAmount The amount of collateral token withdrawn
     * @return actualRepaidDebtTokenAmount The amount of debt token repaid
     */
    function _repayDebtAndWithdrawFromPoolImplementation(
        address caller,
        uint256 collateralTokenToWithdraw
    ) private returns (uint256 withdrawnCollateralTokenAmount, uint256 actualRepaidDebtTokenAmount) {
        // Get the current leverage before repaying the debt (IMPORTANT: this is the leverage before repaying the debt)
        // It is used to calculate the expected withdrawable amount that keeps the current leverage
        uint256 leverageBpsBeforeRepayDebt = getCurrentLeverageBps();

        // Get the amount of debt token to repay to keep the current leverage
        uint256 estimatedRepaidDebtTokenAmount = DLoopCoreLogic.getRepayAmountThatKeepCurrentLeverage(
            collateralTokenToWithdraw,
            leverageBpsBeforeRepayDebt,
            ERC20(collateralToken).decimals(),
            getAssetPriceFromOracle(address(collateralToken)),
            ERC20(debtToken).decimals(),
            getAssetPriceFromOracle(address(debtToken))
        );

        // If don't have enough allowance, revert with the error message
        // This is to early-revert with instruction in the error message
        if (debtToken.allowance(caller, address(this)) < estimatedRepaidDebtTokenAmount) {
            revert InsufficientAllowanceOfDebtAssetToRepay(
                caller,
                address(this),
                address(debtToken),
                estimatedRepaidDebtTokenAmount
            );
        }

        // Transfer the debt token to the vault to repay the debt
        debtToken.safeTransferFrom(caller, address(this), estimatedRepaidDebtTokenAmount);

        // In this case, the vault is user of the lending pool
        // So, we need to repay the debt to the pool on behalf of the vault
        // and then withdraw the collateral from the pool on behalf of the vault

        // Repay the debt to withdraw the collateral
        // Update the repaid debt token amount to the actual amount as this
        // variable is also the return value of this function
        actualRepaidDebtTokenAmount = _repayDebtToPool(
            address(debtToken),
            estimatedRepaidDebtTokenAmount,
            address(this) // the vault is the borrower
        );

        // Withdraw the collateral
        // At this step, the _withdrawFromPool wrapper function will also assert that
        // the withdrawn amount is exactly the amount requested.
        withdrawnCollateralTokenAmount = _withdrawFromPool(
            address(collateralToken),
            collateralTokenToWithdraw,
            address(this) // the vault is the receiver
        );

        // Transfer the unused debt token to the caller
        if (actualRepaidDebtTokenAmount < estimatedRepaidDebtTokenAmount - BALANCE_DIFF_TOLERANCE) {
            uint256 unusedDebtTokenAmount = estimatedRepaidDebtTokenAmount - actualRepaidDebtTokenAmount;
            debtToken.safeTransfer(caller, unusedDebtTokenAmount);
            emit LeftoverDebtTokensTransferred(address(debtToken), unusedDebtTokenAmount, caller);
        }

        return (withdrawnCollateralTokenAmount, actualRepaidDebtTokenAmount);
    }

    /* Withdrawal fee */

    /**
     * @notice Sets the withdrawal fee in basis points
     * @dev Only callable by the contract owner
     * @param newWithdrawalFeeBps The new withdrawal fee in basis points
     */
    function setWithdrawalFeeBps(uint256 newWithdrawalFeeBps) public onlyOwner nonReentrant {
        if (newWithdrawalFeeBps > MAX_WITHDRAWAL_FEE_BPS) {
            revert WithdrawalFeeIsGreaterThanMaxFee(newWithdrawalFeeBps, MAX_WITHDRAWAL_FEE_BPS);
        }
        uint256 oldWithdrawalFeeBps = withdrawalFeeBps;
        withdrawalFeeBps = newWithdrawalFeeBps;
        emit WithdrawalFeeBpsSet(oldWithdrawalFeeBps, newWithdrawalFeeBps);
    }

    /* Rebalance */

    /**
     * @notice Gets the rebalance amount to reach the target leverage in token units
     * @dev This method is used by rebalancing services to quote required collateral/debt amounts
     *      and determine the rebalancing direction (increase or decrease leverage)
     * @return inputTokenAmount The amount of token to call increaseLeverage or decreaseLeverage (in token unit)
     *         - If direction is 1, the amount is in collateral token
     *         - If direction is -1, the amount is in debt token
     * @return estimatedOutputTokenAmount The estimated output token amount after the rebalance (in token unit)
     *         - If direction is 1, the amount is in debt token
     *         - If direction is -1, the amount is in collateral token
     * @return direction The direction of the rebalance (1 for increase, -1 for decrease, 0 means no rebalance)
     */
    function quoteRebalanceAmountToReachTargetLeverage()
        public
        view
        returns (uint256 inputTokenAmount, uint256 estimatedOutputTokenAmount, int8 direction)
    {
        (uint256 totalCollateralBase, uint256 totalDebtBase) = getTotalCollateralAndDebtOfUserInBase(address(this));

        return
            DLoopCoreLogic.quoteRebalanceAmountToReachTargetLeverage(
                totalCollateralBase,
                totalDebtBase,
                getCurrentLeverageBps(),
                targetLeverageBps,
                getCurrentSubsidyBps(),
                ERC20(collateralToken).decimals(),
                getAssetPriceFromOracle(address(collateralToken)),
                ERC20(debtToken).decimals(),
                getAssetPriceFromOracle(address(debtToken))
            );
    }

    /**
     * @notice Increases the leverage of the user by supplying collateral token and borrowing more debt token
     * @dev Requires spending collateral token from the user's wallet to supply to the pool.
     *      Will send the borrowed debt token to the user's wallet.
     * @param inputCollateralTokenAmount The amount of collateral token to deposit
     * @param minReceivedDebtTokenAmount The minimum amount of debt token to receive
     */
    function increaseLeverage(
        uint256 inputCollateralTokenAmount,
        uint256 minReceivedDebtTokenAmount
    ) public nonReentrant {
        /**
         * Example of how this function works:
         *
         * Suppose that the target leverage is 3x, and the baseLTVAsCollateral is 70%
         * - The collateral token is WETH
         * - The debt here is dUSD
         * - Assume that the price of WETH is 2000 dUSD
         * - The current leverage is 1.25x
         *   - Total collateral: 100 WETH (100 * 2000 = 200,000 dUSD)
         *   - Total debt: 40,000 dUSD
         *   - Leverage: 200,000 / (200,000 - 40,000) = 1.25x
         *   - Assume that there is 0 collateral token in the vault
         *
         * 1. User call increaseLeverage with 50 WETH
         * 2. The vault transfers 50 WETH from the user's wallet to the vault
         * 3. The vault supplies 50 WETH to the lending pool
         * 4. The vault borrows 100,000 dUSD (50 * 2000) from the lending pool
         * 5. The vault sends 100,000 dUSD to the user
         *
         * The current leverage is now increased:
         *    - Total collateral: 150 WETH (150 * 2000 = 300,000 dUSD)
         *    - Total debt: 140,000 dUSD
         *    - Leverage: 300,000 / (300,000 - 140,000) = 1.875x
         */

        // Make sure only increase the leverage if it is below the target leverage
        uint256 currentLeverageBpsBeforeIncreaseLeverage = getCurrentLeverageBps();
        if (currentLeverageBpsBeforeIncreaseLeverage >= targetLeverageBps) {
            revert LeverageExceedsTarget(currentLeverageBpsBeforeIncreaseLeverage, targetLeverageBps);
        }

        // Get the amount of debt token to borrow to increase the leverage, given the input collateral token amount
        uint256 borrowedDebtTokenAmount = DLoopCoreLogic.getDebtBorrowTokenAmountToIncreaseLeverage(
            inputCollateralTokenAmount,
            getCurrentSubsidyBps(),
            ERC20(collateralToken).decimals(),
            getAssetPriceFromOracle(address(collateralToken)),
            ERC20(debtToken).decimals(),
            getAssetPriceFromOracle(address(debtToken))
        );

        // Transfer the input collateral token from the caller to the vault
        collateralToken.safeTransferFrom(msg.sender, address(this), inputCollateralTokenAmount);

        // Supply the collateral token to the lending pool
        uint256 actualSuppliedCollateralTokenAmount = _supplyToPool(
            address(collateralToken),
            inputCollateralTokenAmount,
            address(this)
        );

        // At this step, the _borrowFromPool wrapper function will also assert that
        // the borrowed amount is exactly the amount requested, thus we can safely
        // have the slippage check before calling this function
        // Update the debt token amount borrowed to the actual amount
        uint256 actualBorrowedDebtTokenAmount = _borrowFromPool(
            address(debtToken),
            borrowedDebtTokenAmount,
            address(this)
        );

        // Slippage protection, to make sure the user receives at least minReceivedDebtTokenAmount
        // At this step, we check against the actual amount borrowed from the pool
        if (actualBorrowedDebtTokenAmount < minReceivedDebtTokenAmount) {
            revert IncreaseLeverageReceiveLessThanMinAmount(actualBorrowedDebtTokenAmount, minReceivedDebtTokenAmount);
        }

        // Make sure new current leverage is increased and not above the target leverage
        uint256 newCurrentLeverageBps = getCurrentLeverageBps();
        if (
            newCurrentLeverageBps > targetLeverageBps ||
            newCurrentLeverageBps <= currentLeverageBpsBeforeIncreaseLeverage
        ) {
            revert IncreaseLeverageOutOfRange(
                newCurrentLeverageBps,
                targetLeverageBps,
                currentLeverageBpsBeforeIncreaseLeverage
            );
        }

        if (actualBorrowedDebtTokenAmount > 0) {
            // Transfer the debt token to the user
            debtToken.safeTransfer(msg.sender, actualBorrowedDebtTokenAmount);
        }

        emit IncreaseLeverage(
            msg.sender,
            inputCollateralTokenAmount,
            minReceivedDebtTokenAmount,
            actualSuppliedCollateralTokenAmount, // Supplied collateral token amount
            actualBorrowedDebtTokenAmount // Borrowed debt token amount
        );
    }

    /**
     * @notice Decreases the leverage of the user by repaying debt and withdrawing collateral
     * @dev Requires spending debt token from the user's wallet to repay debt to the pool.
     *      Will send the withdrawn collateral asset to the user's wallet.
     * @param inputDebtTokenAmount The amount of debt token to repay
     * @param minReceivedCollateralTokenAmount The minimum amount of collateral asset to receive
     */
    function decreaseLeverage(
        uint256 inputDebtTokenAmount,
        uint256 minReceivedCollateralTokenAmount
    ) public nonReentrant {
        /**
         * Example of how this function works:
         *
         * Suppose that the target leverage is 3x, and the baseLTVAsCollateral is 70%
         * - The collateral token is WETH
         * - The debt here is dUSD
         * - Assume that the price of WETH is 2000 dUSD
         * - The current leverage is 4x
         *   - Total collateral: 100 WETH (100 * 2000 = 200,000 dUSD)
         *   - Total debt: 150,000 dUSD
         *   - Leverage: 200,000 / (200,000 - 150,000) = 4x
         *
         * 1. User call decreaseLeverage with 20,000 dUSD
         * 2. The vault transfers 20,000 dUSD from the user's wallet to the vault
         * 3. The vault repays 20,000 dUSD to the lending pool
         * 4. The vault withdraws 10 WETH (20,000 / 2000) from the lending pool
         * 5. The vault sends 10 WETH to the user
         *
         * The current leverage is now decreased:
         *    - Total collateral: 90 WETH (90 * 2000 = 180,000 dUSD)
         *    - Total debt: 130,000 dUSD
         *    - Leverage: 180,000 / (180,000 - 130,000) = 3.6x
         */

        // Make sure only decrease the leverage if it is above the target leverage
        uint256 currentLeverageBps = getCurrentLeverageBps();
        if (currentLeverageBps <= targetLeverageBps) {
            revert LeverageBelowTarget(currentLeverageBps, targetLeverageBps);
        }

        // Get the amount of collateral token to withdraw to decrease the leverage, given the input debt token amount
        uint256 withdrawnCollateralTokenAmount = DLoopCoreLogic.getCollateralWithdrawTokenAmountToDecreaseLeverage(
            inputDebtTokenAmount,
            getCurrentSubsidyBps(),
            ERC20(collateralToken).decimals(),
            getAssetPriceFromOracle(address(collateralToken)),
            ERC20(debtToken).decimals(),
            getAssetPriceFromOracle(address(debtToken))
        );

        // Transfer the additional debt token from the caller to the vault
        debtToken.safeTransferFrom(msg.sender, address(this), inputDebtTokenAmount);

        // Repay the debt token to the lending pool
        _repayDebtToPool(address(debtToken), inputDebtTokenAmount, address(this));

        // At this step, the _withdrawFromPool wrapper function will also assert that
        // the withdrawn amount is exactly the amount requested, thus we can safely
        // have the slippage check before calling this function
        // Update the withdrawn collateral token amount to the actual amount
        uint256 actualWithdrawnCollateralTokenAmount = _withdrawFromPool(
            address(collateralToken),
            withdrawnCollateralTokenAmount,
            address(this)
        );

        // Slippage protection, to make sure the user receives at least minReceivedAmount
        // At this step, we check against the actual amount withdrawn from the pool
        if (actualWithdrawnCollateralTokenAmount < minReceivedCollateralTokenAmount) {
            revert DecreaseLeverageReceiveLessThanMinAmount(
                actualWithdrawnCollateralTokenAmount,
                minReceivedCollateralTokenAmount
            );
        }

        // Make sure new current leverage is decreased and not below the target leverage
        uint256 newCurrentLeverageBps = getCurrentLeverageBps();
        if (newCurrentLeverageBps < targetLeverageBps || newCurrentLeverageBps >= currentLeverageBps) {
            revert DecreaseLeverageOutOfRange(newCurrentLeverageBps, targetLeverageBps, currentLeverageBps);
        }

        if (actualWithdrawnCollateralTokenAmount > 0) {
            // Transfer the collateral asset to the user
            collateralToken.safeTransfer(msg.sender, actualWithdrawnCollateralTokenAmount);
        }

        emit DecreaseLeverage(
            msg.sender,
            inputDebtTokenAmount,
            minReceivedCollateralTokenAmount,
            inputDebtTokenAmount, // Repaid debt token amount
            actualWithdrawnCollateralTokenAmount // Withdrawn collateral token amount
        );
    }

    /* Informational */

    /**
     * @notice Gets the current leverage in basis points
     * @dev Calculates leverage based on total collateral and debt values
     * @return uint256 The current leverage in basis points
     */
    function getCurrentLeverageBps() public view returns (uint256) {
        (uint256 totalCollateralBase, uint256 totalDebtBase) = getTotalCollateralAndDebtOfUserInBase(address(this));

        return DLoopCoreLogic.getCurrentLeverageBps(totalCollateralBase, totalDebtBase);
    }

    /**
     * @notice Gets the current subsidy in basis points
     * @dev Calculates subsidy based on leverage deviation from target
     * @return uint256 The current subsidy in basis points
     */
    function getCurrentSubsidyBps() public view returns (uint256) {
        return
            DLoopCoreLogic.getCurrentSubsidyBps(
                getCurrentLeverageBps(),
                targetLeverageBps,
                maxSubsidyBps,
                minDeviationBps
            );
    }

    /**
     * @notice Gets the address of the collateral token
     * @return address The address of the collateral token
     */
    function getCollateralTokenAddress() public view returns (address) {
        return address(collateralToken);
    }

    /**
     * @notice Gets the address of the debt token
     * @return address The address of the debt token
     */
    function getDebtTokenAddress() public view returns (address) {
        return address(debtToken);
    }

    /**
     * @notice Gets the default maximum subsidy in basis points
     * @return uint256 The default maximum subsidy in basis points
     */
    function getDefaultMaxSubsidyBps() public view returns (uint256) {
        return maxSubsidyBps;
    }

    /* Admin */

    /**
     * @notice Sets the maximum subsidy in basis points
     * @dev Only callable by the contract owner
     * @param _maxSubsidyBps New maximum subsidy in basis points
     */
    function setMaxSubsidyBps(uint256 _maxSubsidyBps) public onlyOwner nonReentrant {
        uint256 oldMaxSubsidyBps = maxSubsidyBps;
        maxSubsidyBps = _maxSubsidyBps;
        emit MaxSubsidyBpsSet(oldMaxSubsidyBps, _maxSubsidyBps);
    }

    /**
     * @notice Sets the minimum deviation of leverage from the target leverage in basis points
     * @dev Only callable by the contract owner
     * @param _minDeviationBps New minimum deviation of leverage from the target leverage in basis points
     */
    function setMinDeviationBps(uint256 _minDeviationBps) public onlyOwner nonReentrant {
        uint256 oldMinDeviationBps = minDeviationBps;
        minDeviationBps = _minDeviationBps;
        emit MinDeviationBpsSet(oldMinDeviationBps, _minDeviationBps);
    }

    /**
     * @dev Sets the lower and upper bounds of target leverage
     * @param _lowerBoundTargetLeverageBps New lower bound of target leverage in basis points
     * @param _upperBoundTargetLeverageBps New upper bound of target leverage in basis points
     */
    function setLeverageBounds(
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps
    ) public onlyOwner nonReentrant {
        if (_lowerBoundTargetLeverageBps >= targetLeverageBps || targetLeverageBps >= _upperBoundTargetLeverageBps) {
            revert InvalidLeverageBounds(_lowerBoundTargetLeverageBps, targetLeverageBps, _upperBoundTargetLeverageBps);
        }

        lowerBoundTargetLeverageBps = _lowerBoundTargetLeverageBps;
        upperBoundTargetLeverageBps = _upperBoundTargetLeverageBps;

        emit LeverageBoundsSet(_lowerBoundTargetLeverageBps, _upperBoundTargetLeverageBps);
    }

    /* Overrides to add leverage check */

    /**
     * @dev See {IERC4626-maxDeposit}.
     */
    function maxDeposit(address _user) public view override returns (uint256) {
        // Don't allow deposit if the leverage is too imbalanced
        if (isTooImbalanced()) {
            return 0;
        }
        return super.maxDeposit(_user);
    }

    /**
     * @dev See {IERC4626-maxMint}.
     */
    function maxMint(address _user) public view override returns (uint256) {
        // Don't allow mint if the leverage is too imbalanced
        if (isTooImbalanced()) {
            return 0;
        }
        return super.maxMint(_user);
    }

    /**
     * @dev See {IERC4626-maxWithdraw}.
     */
    function maxWithdraw(address _user) public view override returns (uint256) {
        // Don't allow withdraw if the leverage is too imbalanced
        if (isTooImbalanced()) {
            return 0;
        }
        // Return the maximum NET assets after fee
        return DLoopCoreLogic.getNetAmountAfterFee(super.maxWithdraw(_user), withdrawalFeeBps);
    }

    /**
     * @dev See {IERC4626-maxRedeem}.
     */
    function maxRedeem(address _user) public view override returns (uint256) {
        // Don't allow redeem if the leverage is too imbalanced
        if (isTooImbalanced()) {
            return 0;
        }
        // Fee applies on assets, not on shares. Max redeemable shares remain unchanged.
        return super.maxRedeem(_user);
    }

    /**
     * @dev See {IERC4626-previewWithdraw}.
     */
    function previewWithdraw(uint256 assets) public view virtual override returns (uint256) {
        return super.previewWithdraw(DLoopCoreLogic.getGrossAmountRequiredForNet(assets, withdrawalFeeBps));
    }

    /**
     * @dev See {IERC4626-previewRedeem}.
     */
    function previewRedeem(uint256 shares) public view virtual override returns (uint256) {
        return DLoopCoreLogic.getNetAmountAfterFee(super.previewRedeem(shares), withdrawalFeeBps);
    }
}
