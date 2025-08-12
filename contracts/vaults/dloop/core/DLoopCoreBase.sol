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

pragma solidity 0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";
import {ERC4626, ERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Erc20Helper} from "contracts/common/Erc20Helper.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RescuableVault} from "contracts/common/RescuableVault.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

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
 */
abstract contract DLoopCoreBase is
    ERC4626,
    Ownable,
    ReentrancyGuard,
    RescuableVault
{
    using SafeERC20 for ERC20;

    /* Core state */

    uint32 public lowerBoundTargetLeverageBps;
    uint32 public upperBoundTargetLeverageBps;
    uint256 public maxSubsidyBps;

    /* Constants */

    uint32 public immutable targetLeverageBps; // ie. 30000 = 300% in basis points, means 3x leverage
    ERC20 public immutable collateralToken;
    ERC20 public immutable debtToken;

    uint256 public constant BALANCE_DIFF_TOLERANCE = 1;
    uint256 public constant LEVERAGE_DIFF_TOLERANCE = 1;

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

    event MaxSubsidyBpsSet(uint256 maxSubsidyBps);

    event LeverageBoundsSet(
        uint32 lowerBoundTargetLeverageBps,
        uint32 upperBoundTargetLeverageBps
    );

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
    error DepositInsufficientToSupply(
        uint256 currentBalance,
        uint256 newTotalAssets
    );
    error CollateralLessThanDebt(
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    );
    error InsufficientShareBalanceToRedeem(
        address owner,
        uint256 sharesToRedeem,
        uint256 shareBalance
    );
    error WithdrawableIsLessThanRequired(
        address token,
        uint256 assetToRemoveFromLending,
        uint256 withdrawableAmount
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
    error InvalidLeverageBounds(
        uint256 lowerBound,
        uint256 targetLeverage,
        uint256 upperBound
    );
    error AssetPriceIsZero(address asset);
    error LeverageExceedsTarget(
        uint256 currentLeverageBps,
        uint256 targetLeverageBps
    );
    error LeverageBelowTarget(
        uint256 currentLeverageBps,
        uint256 targetLeverageBps
    );
    error IncreaseLeverageReceiveLessThanMinAmount(
        uint256 receivedDebtTokenAmount,
        uint256 minReceivedDebtTokenAmount
    );
    error DecreaseLeverageReceiveLessThanMinAmount(
        uint256 receivedCollateralTokenAmount,
        uint256 minReceivedCollateralTokenAmount
    );
    error InvalidLeverage(uint256 leverageBps);
    error TotalCollateralBaseIsZero();
    error TotalCollateralBaseIsLessThanTotalDebtBase(
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    );
    error WithdrawCollateralTokenInBaseGreaterThanTotalCollateralBase(
        uint256 withdrawCollateralTokenInBase,
        uint256 totalCollateralBase
    );
    error RequiredDebtTokenAmountInBaseGreaterThanTotalDebtBase(
        uint256 requiredDebtTokenAmountInBase,
        uint256 totalDebtBase
    );
    error NewTotalCollateralBaseLessThanNewTotalDebtBase(
        uint256 newTotalCollateralBase,
        uint256 newTotalDebtBase
    );
    error ZeroShares();
    error InputDebtTokenAmountIsZero();
    error InputCollateralTokenAmountIsZero();

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
     */
    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _collateralToken,
        ERC20 _debtToken,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps
    ) ERC20(_name, _symbol) ERC4626(_collateralToken) Ownable(msg.sender) {
        debtToken = _debtToken;
        collateralToken = _collateralToken;

        if (_targetLeverageBps < BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert("Target leverage must be at least 100% in basis points");
        }

        if (
            _lowerBoundTargetLeverageBps >= _targetLeverageBps ||
            _targetLeverageBps >= _upperBoundTargetLeverageBps
        ) {
            revert InvalidLeverageBounds(
                _lowerBoundTargetLeverageBps,
                _targetLeverageBps,
                _upperBoundTargetLeverageBps
            );
        }

        // Make sure collateral token is ERC-20
        if (!Erc20Helper.isERC20(address(_collateralToken))) {
            revert("Collateral token must be an ERC-20");
        }

        // Make sure debt token is ERC-20
        if (!Erc20Helper.isERC20(address(_debtToken))) {
            revert("Debt token must be an ERC-20");
        }

        targetLeverageBps = _targetLeverageBps;
        lowerBoundTargetLeverageBps = _lowerBoundTargetLeverageBps;
        upperBoundTargetLeverageBps = _upperBoundTargetLeverageBps;
        maxSubsidyBps = _maxSubsidyBps;
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
    )
        public
        view
        virtual
        returns (uint256 totalCollateralBase, uint256 totalDebtBase);

    /**
     * @dev Gets the additional rescue tokens
     *      - As the getRestrictedRescueTokens function is very critical and we do not
     *        want to override it in the derived contracts, we use this function to
     *        get the additional rescue tokens
     * @return address[] Additional rescue tokens
     */
    function _getAdditionalRescueTokensImplementation()
        internal
        view
        virtual
        returns (address[] memory);

    /**
     * @dev Gets the asset price from the oracle
     * @param asset Address of the asset
     * @return uint256 Price of the asset
     */
    function _getAssetPriceFromOracleImplementation(
        address asset
    ) internal view virtual returns (uint256);

    /**
     * @dev Supply tokens to the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to supply
     * @param onBehalfOf Address to supply on behalf of
     */
    function _supplyToPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal virtual;

    /**
     * @dev Borrow tokens from the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to borrow
     * @param onBehalfOf Address to borrow on behalf of
     */
    function _borrowFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal virtual;

    /**
     * @dev Repay debt to the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to repay
     * @param onBehalfOf Address to repay on behalf of
     */
    function _repayDebtToPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal virtual;

    /**
     * @dev Withdraw tokens from the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to withdraw
     * @param onBehalfOf Address to withdraw on behalf of
     */
    function _withdrawFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal virtual;

    /* Wrapper Functions */

    /**
     * @dev Supply tokens to the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to supply
     * @param onBehalfOf Address to supply on behalf of
     * @return uint256 The amount of tokens supplied
     */
    function _supplyToPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal returns (uint256) {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeSupply = ERC20(token).balanceOf(onBehalfOf);

        _supplyToPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterSupply = ERC20(token).balanceOf(onBehalfOf);
        if (tokenBalanceAfterSupply >= tokenBalanceBeforeSupply) {
            revert TokenBalanceNotDecreasedAfterSupply(
                token,
                tokenBalanceBeforeSupply,
                tokenBalanceAfterSupply,
                amount
            );
        }

        // Now, as balance before must be greater than balance after, we can just check if the difference is the expected amount
        // Allow a 1-wei rounding tolerance when comparing the observed balance change with `amount`
        uint256 observedDiffSupply = tokenBalanceBeforeSupply -
            tokenBalanceAfterSupply;

        if (observedDiffSupply > amount) {
            if (observedDiffSupply - amount > BALANCE_DIFF_TOLERANCE) {
                revert UnexpectedSupplyAmountToPool(
                    token,
                    tokenBalanceBeforeSupply,
                    tokenBalanceAfterSupply,
                    amount
                );
            }
        } else {
            if (amount - observedDiffSupply > BALANCE_DIFF_TOLERANCE) {
                revert UnexpectedSupplyAmountToPool(
                    token,
                    tokenBalanceBeforeSupply,
                    tokenBalanceAfterSupply,
                    amount
                );
            }
        }

        // Return the observed value to avoid the case when the actual amount is 1 wei different from the expected amount
        return observedDiffSupply;
    }

    /**
     * @dev Borrow tokens from the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to borrow
     * @param onBehalfOf Address to borrow on behalf of
     * @return uint256 The amount of tokens borrowed
     */
    function _borrowFromPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal returns (uint256) {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeBorrow = ERC20(token).balanceOf(onBehalfOf);

        _borrowFromPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterBorrow = ERC20(token).balanceOf(onBehalfOf);
        if (tokenBalanceAfterBorrow <= tokenBalanceBeforeBorrow) {
            revert TokenBalanceNotIncreasedAfterBorrow(
                token,
                tokenBalanceBeforeBorrow,
                tokenBalanceAfterBorrow,
                amount
            );
        }

        // Allow a 1-wei rounding tolerance when comparing the observed balance change with `amount`
        uint256 observedDiffBorrow = tokenBalanceAfterBorrow -
            tokenBalanceBeforeBorrow;
        if (observedDiffBorrow > amount) {
            if (observedDiffBorrow - amount > BALANCE_DIFF_TOLERANCE) {
                revert UnexpectedBorrowAmountFromPool(
                    token,
                    tokenBalanceBeforeBorrow,
                    tokenBalanceAfterBorrow,
                    amount
                );
            }
        } else {
            if (amount - observedDiffBorrow > BALANCE_DIFF_TOLERANCE) {
                revert UnexpectedBorrowAmountFromPool(
                    token,
                    tokenBalanceBeforeBorrow,
                    tokenBalanceAfterBorrow,
                    amount
                );
            }
        }

        // Now, as balance before must be less than balance after, we can just check if the difference is the expected amount
        // NOTE: A second strict equality comparison is no longer necessary.
        // The tolerance enforcement performed above (±BALANCE_DIFF_TOLERANCE)
        // already guarantees that any rounding variance is within an
        // acceptable 1-wei window, so we purposefully avoid reverting here.

        // Return the observed value to avoid the case when the actual amount is 1 wei different from the expected amount
        return observedDiffBorrow;
    }

    /**
     * @dev Repay debt to the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to repay
     * @param onBehalfOf Address to repay on behalf of
     * @return uint256 The amount of tokens repaid
     */
    function _repayDebtToPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal returns (uint256) {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeRepay = ERC20(token).balanceOf(onBehalfOf);

        _repayDebtToPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterRepay = ERC20(token).balanceOf(onBehalfOf);

        // Ensure the balance actually decreased
        if (tokenBalanceAfterRepay >= tokenBalanceBeforeRepay) {
            revert TokenBalanceNotDecreasedAfterRepay(
                token,
                tokenBalanceBeforeRepay,
                tokenBalanceAfterRepay,
                amount
            );
        }

        // Now, allow a 1-wei rounding tolerance on the observed balance decrease.
        uint256 observedDiffRepay = tokenBalanceBeforeRepay -
            tokenBalanceAfterRepay;
        if (observedDiffRepay > amount) {
            if (observedDiffRepay - amount > BALANCE_DIFF_TOLERANCE) {
                revert UnexpectedRepayAmountToPool(
                    token,
                    tokenBalanceBeforeRepay,
                    tokenBalanceAfterRepay,
                    amount
                );
            }
        } else {
            if (amount - observedDiffRepay > BALANCE_DIFF_TOLERANCE) {
                revert UnexpectedRepayAmountToPool(
                    token,
                    tokenBalanceBeforeRepay,
                    tokenBalanceAfterRepay,
                    amount
                );
            }
        }

        // Return the observed value to avoid the case when the actual amount is 1 wei different from the expected amount
        return observedDiffRepay;
    }

    /**
     * @dev Withdraw tokens from the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to withdraw
     * @param onBehalfOf Address to withdraw on behalf of
     * @return uint256 The amount of tokens withdrawn
     */
    function _withdrawFromPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal returns (uint256) {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeWithdraw = ERC20(token).balanceOf(onBehalfOf);

        _withdrawFromPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterWithdraw = ERC20(token).balanceOf(onBehalfOf);

        // Ensure the balance actually increased
        if (tokenBalanceAfterWithdraw <= tokenBalanceBeforeWithdraw) {
            revert TokenBalanceNotIncreasedAfterWithdraw(
                token,
                tokenBalanceBeforeWithdraw,
                tokenBalanceAfterWithdraw,
                amount
            );
        }

        // Allow a 1-wei rounding tolerance on the observed balance increase
        uint256 observedDiffWithdraw = tokenBalanceAfterWithdraw -
            tokenBalanceBeforeWithdraw;
        if (observedDiffWithdraw > amount) {
            if (observedDiffWithdraw - amount > BALANCE_DIFF_TOLERANCE) {
                revert UnexpectedWithdrawAmountFromPool(
                    token,
                    tokenBalanceBeforeWithdraw,
                    tokenBalanceAfterWithdraw,
                    amount
                );
            }
        } else {
            if (amount - observedDiffWithdraw > BALANCE_DIFF_TOLERANCE) {
                revert UnexpectedWithdrawAmountFromPool(
                    token,
                    tokenBalanceBeforeWithdraw,
                    tokenBalanceAfterWithdraw,
                    amount
                );
            }
        }

        // Return the observed value to avoid the case when the actual amount is 1 wei different from the expected amount
        return observedDiffWithdraw;
    }

    /* Safety */

    /**
     * @dev Gets the restricted rescue tokens
     * @return address[] Restricted rescue tokens
     */
    function getRestrictedRescueTokens()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        // Get the additional rescue tokens from the derived contract
        address[]
            memory additionalRescueTokens = _getAdditionalRescueTokensImplementation();

        // Restrict the rescue tokens to the collateral token and the debt token
        // as they are going to be used to compensate subsidies during the rebalance
        address[] memory restrictedRescueTokens = new address[](
            2 + additionalRescueTokens.length
        );
        restrictedRescueTokens[0] = address(collateralToken);
        restrictedRescueTokens[1] = address(debtToken);

        // Concatenate the restricted rescue tokens and the additional rescue tokens
        for (uint256 i = 0; i < additionalRescueTokens.length; i++) {
            restrictedRescueTokens[2 + i] = additionalRescueTokens[i];
        }
        return restrictedRescueTokens;
    }

    /* Helper Functions */

    /**
     * @dev Calculates the leveraged amount of the assets with the target leverage
     * @param assets Amount of assets
     * @return leveragedAssets Amount of leveraged assets
     */
    function getTargetLeveragedAssets(
        uint256 assets
    ) public view returns (uint256) {
        return
            Math.mulDiv(
                assets,
                targetLeverageBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );
    }

    /**
     * @dev Calculates the leveraged amount of the assets with the current leverage
     * @param assets Amount of assets
     * @return leveragedAssets Amount of leveraged assets
     */
    function getCurrentLeveragedAssets(
        uint256 assets
    ) public view returns (uint256) {
        return
            (assets * getCurrentLeverageBps()) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
    }

    /**
     * @dev Calculates the unleveraged amount of the assets with the target leverage
     * @param leveragedAssets Amount of leveraged assets
     * @return unleveragedAssets Amount of unleveraged assets
     */
    function getUnleveragedAssetsWithTargetLeverage(
        uint256 leveragedAssets
    ) public view returns (uint256) {
        return
            Math.mulDiv(
                leveragedAssets,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                targetLeverageBps
            );
    }

    /**
     * @dev Calculates the unleveraged amount of the assets with the current leverage
     * @param leveragedAssets Amount of leveraged assets
     * @return unleveragedAssets Amount of unleveraged assets
     */
    function getUnleveragedAssetsWithCurrentLeverage(
        uint256 leveragedAssets
    ) public view returns (uint256) {
        return
            (leveragedAssets * BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
            getCurrentLeverageBps();
    }

    /**
     * @dev Gets the asset price from the oracle
     * @param asset Address of the asset
     * @return uint256 Price of the asset
     */
    function getAssetPriceFromOracle(
        address asset
    ) public view returns (uint256) {
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
    function convertFromBaseCurrencyToToken(
        uint256 amountInBase,
        address token
    ) public view returns (uint256) {
        // The price decimals is cancelled out in the division (as the amount and price are in the same unit)
        uint256 tokenPriceInBase = getAssetPriceFromOracle(token);
        return
            Math.mulDiv(
                amountInBase,
                10 ** ERC20(token).decimals(),
                tokenPriceInBase
            );
    }

    /**
     * @dev Converts an amount in the token to the actual amount in base currency
     * @param amountInToken Amount in the token
     * @param token Address of the token
     * @return amountInBase Amount in base currency
     */
    function convertFromTokenAmountToBaseCurrency(
        uint256 amountInToken,
        address token
    ) public view returns (uint256) {
        // The token decimals is cancelled out in the division (as the amount and price are in the same unit)
        uint256 tokenPriceInBase = getAssetPriceFromOracle(token);
        return
            Math.mulDiv(
                amountInToken,
                tokenPriceInBase,
                10 ** ERC20(token).decimals()
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
        (uint256 totalCollateralBase, ) = getTotalCollateralAndDebtOfUserInBase(
            address(this)
        );
        // The price decimals is cancelled out in the division (as the amount and price are in the same unit)
        return
            convertFromBaseCurrencyToToken(
                totalCollateralBase,
                address(collateralToken)
            );
    }

    /* Safety */

    /**
     * @dev Returns whether the current leverage is too imbalanced
     * @return bool True if leverage is too imbalanced, false otherwise
     */
    function isTooImbalanced() public view returns (bool) {
        uint256 currentLeverageBps = getCurrentLeverageBps();
        // If there is no deposit yet, we don't need to rebalance, thus it is not too imbalanced
        return
            currentLeverageBps != 0 &&
            (currentLeverageBps < lowerBoundTargetLeverageBps ||
                currentLeverageBps > upperBoundTargetLeverageBps);
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
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
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
            revert TooImbalanced(
                getCurrentLeverageBps(),
                lowerBoundTargetLeverageBps,
                upperBoundTargetLeverageBps
            );
        }

        uint256 debtAssetBorrowed = _supplyAndBorrowFromPoolImplementation(
            caller,
            assets
        );

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
     * @return debtAssetAmountToBorrow Amount of debt asset to borrow
     */
    function _supplyAndBorrowFromPoolImplementation(
        address caller,
        uint256 supplyAssetAmount // supply amount
    ) private returns (uint256) {
        // Transfer the assets to the vault (need the allowance before calling this function)
        collateralToken.safeTransferFrom(
            caller,
            address(this),
            supplyAssetAmount
        );

        // At this step, we assume that the funds from the depositor are already in the vault

        // Get current leverage before supplying (IMPORTANT: this is the leverage before supplying)
        uint256 currentLeverageBpsBeforeSupply = getCurrentLeverageBps();

        // Make sure we have enough balance to supply before supplying
        uint256 currentCollateralTokenBalance = collateralToken.balanceOf(
            address(this)
        );
        if (currentCollateralTokenBalance < supplyAssetAmount) {
            revert DepositInsufficientToSupply(
                currentCollateralTokenBalance,
                supplyAssetAmount
            );
        }

        // In this case, the vault is user of the lending pool
        // So, we need to supply the collateral token to the pool on behalf of the vault
        // and then borrow the debt token from the pool on behalf of the vault

        // Supply the collateral token to the lending pool
        // Update the supply asset amount to the actual amount
        supplyAssetAmount = _supplyToPool(
            address(collateralToken),
            supplyAssetAmount,
            address(this) // the vault is the supplier
        );

        // Get the amount of debt token to borrow that keeps the current leverage
        // If there is no deposit yet (leverage=0), we use the target leverage
        uint256 debtTokenAmountToBorrow = getBorrowAmountThatKeepCurrentLeverage(
                address(collateralToken),
                address(debtToken),
                supplyAssetAmount,
                currentLeverageBpsBeforeSupply > 0
                    ? currentLeverageBpsBeforeSupply
                    : targetLeverageBps
            );

        // Borrow the max amount of debt token
        // Update the debt token amount borrowed to the actual amount
        debtTokenAmountToBorrow = _borrowFromPool(
            address(debtToken),
            debtTokenAmountToBorrow,
            address(this) // the vault is the borrower
        );

        return debtTokenAmountToBorrow;
    }

    /* Withdraw and Redeem */

    /**
     * @dev Withdraws collateral assets from the vault
     *      - It requires to spend the debt token to repay the debt
     *      - It will send the withdrawn collateral assets to the receiver and burn the shares
     *      - The burned shares represent the position of the withdrawn assets in the lending pool
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

        // Check user's balance before burning shares
        uint256 userShares = balanceOf(owner);
        if (userShares < shares) {
            revert InsufficientShareBalanceToRedeem(owner, shares, userShares);
        }

        // Burn the shares
        _burn(owner, shares);

        // Make sure the current leverage is within the target range
        if (isTooImbalanced()) {
            revert TooImbalanced(
                getCurrentLeverageBps(),
                lowerBoundTargetLeverageBps,
                upperBoundTargetLeverageBps
            );
        }

        // Withdraw the collateral from the lending pool
        // After this step, the _withdrawFromPool wrapper function will also assert that
        // the withdrawn amount is exactly the amount requested.
        _repayDebtAndWithdrawFromPoolImplementation(caller, assets);

        // Transfer the asset to the receiver
        collateralToken.safeTransfer(receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    /**
     * @dev Handles the logic for repaying debt and withdrawing collateral from the pool
     *      - It calculates the required debt token to repay to keep the current leverage
     *        given the expected withdraw amount
     *      - Then performs the actual repay and withdraw
     * @param caller Address of the caller
     * @param collateralTokenToWithdraw The amount of collateral token to withdraw
     * @return repaidDebtTokenAmount The amount of debt token repaid
     */
    function _repayDebtAndWithdrawFromPoolImplementation(
        address caller,
        uint256 collateralTokenToWithdraw
    ) private returns (uint256 repaidDebtTokenAmount) {
        // Get the current leverage before repaying the debt (IMPORTANT: this is the leverage before repaying the debt)
        // It is used to calculate the expected withdrawable amount that keeps the current leverage
        uint256 leverageBpsBeforeRepayDebt = getCurrentLeverageBps();

        repaidDebtTokenAmount = getRepayAmountThatKeepCurrentLeverage(
            address(collateralToken),
            address(debtToken),
            collateralTokenToWithdraw,
            leverageBpsBeforeRepayDebt
        );

        // If don't have enough allowance, revert with the error message
        // This is to early-revert with instruction in the error message
        if (
            debtToken.allowance(caller, address(this)) < repaidDebtTokenAmount
        ) {
            revert InsufficientAllowanceOfDebtAssetToRepay(
                caller,
                address(this),
                address(debtToken),
                repaidDebtTokenAmount
            );
        }

        // Transfer the debt token to the vault to repay the debt
        debtToken.safeTransferFrom(
            caller,
            address(this),
            repaidDebtTokenAmount
        );

        // In this case, the vault is user of the lending pool
        // So, we need to repay the debt to the pool on behalf of the vault
        // and then withdraw the collateral from the pool on behalf of the vault

        // Repay the debt to withdraw the collateral
        // Update the repaid debt token amount to the actual amount
        repaidDebtTokenAmount = _repayDebtToPool(
            address(debtToken),
            repaidDebtTokenAmount,
            address(this) // the vault is the borrower
        );

        // Withdraw the collateral
        // At this step, the _withdrawFromPool wrapper function will also assert that
        // the withdrawn amount is exactly the amount requested.
        _withdrawFromPool(
            address(collateralToken),
            collateralTokenToWithdraw,
            address(this) // the vault is the receiver
        );

        return repaidDebtTokenAmount;
    }

    /* Calculate */

    function getRepayAmountThatKeepCurrentLeverage(
        address collateralAsset,
        address debtAsset,
        uint256 targetWithdrawAmount,
        uint256 leverageBpsBeforeRepayDebt
    ) public view returns (uint256 repayAmount) {
        /* Formula definition:
         * - C1: totalCollateralBase before repay (in base currency)
         * - D1: totalDebtBase before repay (in base currency)
         * - C2: totalCollateralBase after repay (in base currency)
         * - D2: totalDebtBase after repay (in base currency)
         * - T: target leverage
         * - x: withdraw amount in base currency
         * - y: repay amount in base currency
         *
         * We have:
         *        C1 / (C1-D1) = C2 / (C2-D2)
         *        C2 = C1-x
         *        D2 = D1-y
         *        C1 / (C1-D1) = T <=> C1 = (C1-D1) * T <=> C1 = C1*T - D1*T <=> C1*T - C1 = D1*T <=> C1 = D1*T/(T-1)
         *
         * Formula expression:
         *        C1 / (C1-D1) = (C1-x) / (C1-x-D1+y)
         *    <=> C1 * (C1-x-D1+y) = (C1-x) * (C1-D1)
         *    <=> C1^2 - C1*x - C1*D1 + C1*y = C1^2 - C1*D1 - C1*x + D1*x
         *    <=> C1^2 - C1*x - C1*D1 + C1*y = C1^2 - C1*x - C1*D1 + D1*x
         *    <=> C1*y = x*D1
         *    <=> y = x*D1 / C1
         *    <=> y = x*D1 / [D1*T / (T-1)]
         *    <=> y = x * (T-1)/T
         *
         * Suppose that T' = T * ONE_HUNDRED_PERCENT_BPS, then:
         *
         *  => T = T' / ONE_HUNDRED_PERCENT_BPS
         * where T' is the target leverage in basis points unit
         *
         * We have:
         *      y = x * (T-1)/T
         *  <=> y = x * (T' / ONE_HUNDRED_PERCENT_BPS - 1) / (T' / ONE_HUNDRED_PERCENT_BPS)
         *  <=> y = x * (T' - ONE_HUNDRED_PERCENT_BPS) / T'
         */

        // Short-circuit when leverageBpsBeforeRepayDebt == 0
        if (leverageBpsBeforeRepayDebt == 0) {
            // no collateral means no debt yet, so nothing to repay
            return 0;
        }

        // Convert the target withdraw amount to base
        uint256 targetWithdrawAmountInBase = convertFromTokenAmountToBaseCurrency(
                targetWithdrawAmount,
                collateralAsset
            );

        // Calculate the repay amount in base
        uint256 repayAmountInBase = Math.mulDiv(
            targetWithdrawAmountInBase,
            leverageBpsBeforeRepayDebt -
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
            leverageBpsBeforeRepayDebt
        );

        return convertFromBaseCurrencyToToken(repayAmountInBase, debtAsset);
    }

    /**
     * @dev Gets the borrow amount that keeps the current leverage
     * @param collateralAsset The collateral asset
     * @param debtAsset The debt asset
     * @param suppliedCollateralAmount The actual supplied amount of collateral asset
     * @param leverageBpsBeforeSupply Leverage in basis points before supplying
     * @return expectedBorrowAmount The expected borrow amount that keeps the current leverage
     */
    function getBorrowAmountThatKeepCurrentLeverage(
        address collateralAsset,
        address debtAsset,
        uint256 suppliedCollateralAmount,
        uint256 leverageBpsBeforeSupply
    ) public view returns (uint256 expectedBorrowAmount) {
        /* Formula definition:
         * - C1: totalCollateralBase before supply (in base currency)
         * - D1: totalDebtBase before supply (in base currency)
         * - C2: totalCollateralBase after supply (in base currency)
         * - D2: totalDebtBase after supply (in base currency)
         * - T: target leverage
         * - x: supply amount in base currency
         * - y: borrow amount in base currency
         *
         * We have:
         *      C1 / (C1-D1) = C2 / (C2-D2)
         *      C2 = C1+x
         *      D2 = D1+y
         *      C1 / (C1-D1) = T <=> C1 = (C1-D1) * T <=> C1 = C1*T - D1*T <=> C1*T - C1 = D1*T <=> C1 = D1*T/(T-1)
         *
         * Formula expression:
         *      C1 / (C1-D1) = (C1+x) / (C1+x-D1-y)
         *  <=> C1 * (C1+x-D1-y) = (C1+x) * (C1-D1)
         *  <=> C1^2 + C1*x - C1*D1 - C1*y = C1^2 - C1*D1 + C1*x - D1*x
         *  <=> C1*y = x*D1
         *  <=> y = x*D1 / C1
         *  <=> y = x * (T-1)/T
         *
         * Suppose that:
         *      T' = T * ONE_HUNDRED_PERCENT_BPS, then:
         *   => T = T' / ONE_HUNDRED_PERCENT_BPS
         * where:
         *      - T' is the target leverage in basis points unit
         *
         * This is the formula to calculate the borrow amount that keeps the current leverage:
         *      y = x * (T-1)/T
         *  <=> y = x * (T' / ONE_HUNDRED_PERCENT_BPS - 1) / (T' / ONE_HUNDRED_PERCENT_BPS)
         *  <=> y = x * (T' - ONE_HUNDRED_PERCENT_BPS) / T'
         */

        // Short-circuit when leverageBpsBeforeSupply == 0
        if (leverageBpsBeforeSupply == 0) {
            // no collateral thus cannot borrow any debt
            return 0;
        }

        // Convert the actual supplied amount to base
        uint256 suppliedCollateralAmountInBase = convertFromTokenAmountToBaseCurrency(
                suppliedCollateralAmount,
                collateralAsset
            );

        // Calculate the borrow amount in base currency that keeps the current leverage
        uint256 borrowAmountInBase = Math.mulDiv(
            suppliedCollateralAmountInBase,
            leverageBpsBeforeSupply -
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
            leverageBpsBeforeSupply
        );

        return convertFromBaseCurrencyToToken(borrowAmountInBase, debtAsset);
    }

    /* Rebalance */

    /**
     * @dev Gets the collateral token amount to reach the target leverage
     *      - This method is only being called for increasing the leverage quote in quoteRebalanceAmountToReachTargetLeverage()
     *      - It will failed if the current leverage is above the target leverage (which requires the user to call decreaseLeverage)
     * @param expectedTargetLeverageBps The expected target leverage in basis points unit
     * @param totalCollateralBase The total collateral base
     * @param totalDebtBase The total debt base
     * @param subsidyBps The subsidy in basis points unit
     * @return requiredCollateralDepositAmountInBase The collateral deposit amount in base currency
     */
    function _getCollateralTokenDepositAmountToReachTargetLeverage(
        uint256 expectedTargetLeverageBps,
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 subsidyBps
    ) internal pure returns (uint256 requiredCollateralDepositAmountInBase) {
        /**
         * Find the amount of collateral to be deposited and the corresponding amount of debt token to be borrowed to rebalance
         *
         * The amount of debt token to be borrowed is a bit more than the deposited collateral to pay for the rebalancing subsidy
         * - Rebalancing caller will receive the debt token as the subsidy
         *
         * Formula definition:
         * - C: totalCollateralBase
         * - D: totalDebtBase
         * - T: target leverage
         * - k: subsidy (0.01 means 1%)
         * - x: change amount of collateral in base currency
         * - y: change amount of debt in base currency
         *
         * We have:
         *      y = x*(1+k)   (borrow a bit more debt than the deposited collateral to pay for the rebalancing subsidy)
         *
         * Because this is a deposit collateral and borrow debt process, the formula is:
         *      (C + x) / (C + x - D - y) = T
         *  <=> C + x = T * (C + x - D - y)
         *  <=> C + x = T * (C + x - D - x*(1+k))
         *  <=> C + x = T * (C + x - D - x - x*k)
         *  <=> C + x = T * (C - D - x*k)
         *  <=> C + x = T*C - T*D - T*x*k
         *  <=> x + T*x*k = T*C - T*D - C
         *  <=> x*(1 + T*k) = T*(C - D) - C
         *  <=> x = (T*(C - D) - C) / (1 + T*k)
         *
         * Suppose that:
         *      TT = T * ONE_HUNDRED_PERCENT_BPS
         *      kk = k * ONE_HUNDRED_PERCENT_BPS
         * then:
         *      T = TT / ONE_HUNDRED_PERCENT_BPS
         *      k = kk / ONE_HUNDRED_PERCENT_BPS
         * where:
         *      - TT is the target leverage in basis points unit
         *      - kk is the subsidy in basis points unit
         *
         * We have:
         *      x = (T*(C - D) - C) / (1 + T*k)
         *  <=> x = (TT*(C - D)/ONE_HUNDRED_PERCENT_BPS - C) / (1 + TT*kk/ONE_HUNDRED_PERCENT_BPS^2)
         *  <=> x = (TT*(C - D) - C*ONE_HUNDRED_PERCENT_BPS) / (ONE_HUNDRED_PERCENT_BPS + TT*kk/ONE_HUNDRED_PERCENT_BPS)
         *  <=> x = (TT*(C - D) - C*ONE_HUNDRED_PERCENT_BPS) / denominator
         * where:
         *      denominator = ONE_HUNDRED_PERCENT_BPS + TT*kk/ONE_HUNDRED_PERCENT_BPS
         *
         * If x < 0, the transaction will be reverted due to the underflow/overflow
         *
         * If x = 0, it means the user should not rebalance, so the direction is 0
         *
         * Finally, we have y = (1+k)*x:
         *   => y = (1+k) * x
         *  <=> y = (1 + kk/ONE_HUNDRED_PERCENT_BPS) * x
         *  <=> y = (ONE_HUNDRED_PERCENT_BPS + kk) * x / ONE_HUNDRED_PERCENT_BPS
         *
         * The value of y here is for reference (the expected amount of debt to borrow)
         */
        if (totalCollateralBase == 0) {
            revert TotalCollateralBaseIsZero();
        }
        if (totalCollateralBase < totalDebtBase) {
            revert TotalCollateralBaseIsLessThanTotalDebtBase(
                totalCollateralBase,
                totalDebtBase
            );
        }

        uint256 denominator = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
            Math.mulDiv(
                expectedTargetLeverageBps,
                subsidyBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );

        // Use ceilDiv as we want to round up required collateral deposit amount in base currency
        // to avoid getting the new leverage above the target leverage, which will revert the
        // rebalance process (due to post-process assertion)
        // The logic is to deposit a bit more collateral, and borrow a bit more debt (due to rounding),
        // which will guarantee the new leverage cannot be more than the target leverage, avoid
        // unexpected post-process assertion revert.
        requiredCollateralDepositAmountInBase = Math.ceilDiv(
            expectedTargetLeverageBps *
                (totalCollateralBase - totalDebtBase) -
                totalCollateralBase *
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
            denominator
        );

        return requiredCollateralDepositAmountInBase;
    }

    /**
     * @dev Gets the debt amount in base currency to be borrowed to increase the leverage
     * @param inputCollateralDepositAmountInBase The collateral deposit amount in base currency
     * @param subsidyBps The subsidy in basis points unit
     * @return outputDebtBorrowAmountInBase The debt amount in base currency to be borrowed
     */
    function _getDebtBorrowAmountInBaseToIncreaseLeverage(
        uint256 inputCollateralDepositAmountInBase,
        uint256 subsidyBps
    ) internal pure returns (uint256 outputDebtBorrowAmountInBase) {
        /**
         * The formula is:
         *      y = (1+k) * x
         *  <=> y = (1 + kk/ONE_HUNDRED_PERCENT_BPS) * x
         *  <=> y = (ONE_HUNDRED_PERCENT_BPS + kk) * x / ONE_HUNDRED_PERCENT_BPS
         *
         * where:
         *      - y is the debt amount in base currency to be borrowed
         *      - x is the collateral amount in base currency to be deposited
         *      - kk is the subsidy in basis points unit
         *
         * For more detail, check the comment in _getCollateralTokenDepositAmountToReachTargetLeverage()
         */

        // Use rounding down with mulDiv with Rounding.Floor as we want to borrow a bit less, to avoid
        // getting the new leverage above the target leverage, which will revert the
        // rebalance process (due to post-process assertion)
        // Borrow a bit less debt (rounding), given the same deposit amount of collateral token
        // means the new leverage should be lower than the actual leverage (with decimal without rounding)
        // As we calculate the estimated final leverage is reaching the target leverage,
        // if we round up, the new leverage can be more than the target leverage (given
        // the same deposit amount of collateral token), which will revert the rebalance process (due to post-process assertion)
        return
            Math.mulDiv(
                inputCollateralDepositAmountInBase,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS + subsidyBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                Math.Rounding.Floor
            );
    }

    /**
     * @dev Gets the debt amount in base currency to reach the target leverage
     *      - This method is only being called for decreasing the leverage quote in quoteRebalanceAmountToReachTargetLeverage()
     *      - It will failed if the current leverage is below the target leverage (which requires the user to call increaseLeverage)
     * @param expectedTargetLeverageBps The expected target leverage in basis points unit
     * @param totalCollateralBase The total collateral base
     * @param totalDebtBase The total debt base
     * @param subsidyBps The subsidy in basis points unit
     * @return requiredDebtRepayAmountInBase The debt amount in base currency to be repaid
     */
    function _getDebtRepayAmountInBaseToReachTargetLeverage(
        uint256 expectedTargetLeverageBps,
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 subsidyBps
    ) internal pure returns (uint256 requiredDebtRepayAmountInBase) {
        /**
         * Find the amount of debt to be repaid and the corresponding amount of collateral to be withdraw to rebalance
         *
         * The amount of collateral to be withdraw to rebalance which is a bit more than the repay amount of debt token
         * to pay for the rebalancing subsidy
         * - Rebalancing caller will receive the collateral token as the subsidy
         *
         * Formula definition:
         * - C: totalCollateralBase
         * - D: totalDebtBase
         * - T: target leverage
         * - k: subsidy (0.01 means 1%)
         * - x: change amount of collateral in base currency
         * - y: change amount of debt in base currency
         *
         * We have:
         *      x = y*(1+k)   (withdraw a bit more collateral than the debt to pay for the rebalancing subsidy)
         *
         * Because this is a repay debt and withdraw collateral process, the formula is:
         *      (C - x) / (C - x - D + y) = T
         *  <=> C - y*(1+k) = T * (C - y*(1+k) - D + y)
         *  <=> C - y*(1+k) = T * (C - y - y*k - D + y)
         *  <=> C - y*(1+k) = T * (C - D - y*k)
         *  <=> y*(1+k) = C - T * (C - D - y*k)
         *  <=> y*(1+k) = C - T*C + T*D + T*y*k
         *  <=> y*(1+k) - T*y*k = C - T*C + T*D
         *  <=> y*(1 + k - T*k) = C - T*C + T*D
         *  <=> y = (C - T*C + T*D) / (1 + k - T*k)
         *
         * Suppose that:
         *      TT = T * ONE_HUNDRED_PERCENT_BPS
         *      kk = k * ONE_HUNDRED_PERCENT_BPS
         * then:
         *      T = TT / ONE_HUNDRED_PERCENT_BPS
         *      k = kk / ONE_HUNDRED_PERCENT_BPS
         * where:
         *      - TT is the target leverage in basis points unit
         *      - kk is the subsidy in basis points unit
         *
         * We have:
         *      y = (C - T*C + T*D) / (1 + k - T*k)
         *  <=> y = (C - TT*C/ONE_HUNDRED_PERCENT_BPS + TT*D/ONE_HUNDRED_PERCENT_BPS) / (1 + kk/ONE_HUNDRED_PERCENT_BPS - TT*kk/ONE_HUNDRED_PERCENT_BPS^2)
         *  <=> y = (C*ONE_HUNDRED_PERCENT_BPS - TT*C + TT*D) / (ONE_HUNDRED_PERCENT_BPS + kk - TT*kk/ONE_HUNDRED_PERCENT_BPS)
         *  <=> y = (C*ONE_HUNDRED_PERCENT_BPS - TT*C + TT*D) / denominator
         *  <=> y = (C*ONE_HUNDRED_PERCENT_BPS - TT*(C - D)) / denominator
         * where:
         *      denominator = ONE_HUNDRED_PERCENT_BPS + kk - TT*kk/ONE_HUNDRED_PERCENT_BPS
         *
         * If y < 0, the transaction will be reverted due to the underflow/overflow
         *
         * If y = 0, it means the user should not rebalance, so the direction is 0
         *
         * Finally, we have x = (1+k)*y:
         *   => x = (1+k) * y
         *  <=> x = (1 + kk/ONE_HUNDRED_PERCENT_BPS) * y
         *  <=> x = (ONE_HUNDRED_PERCENT_BPS + kk) * y / ONE_HUNDRED_PERCENT_BPS
         *
         * The value of x here is for reference (the expected amount of collateral to withdraw)
         */
        if (totalCollateralBase == 0) {
            revert TotalCollateralBaseIsZero();
        }
        if (totalCollateralBase < totalDebtBase) {
            revert TotalCollateralBaseIsLessThanTotalDebtBase(
                totalCollateralBase,
                totalDebtBase
            );
        }

        uint256 denominator = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
            subsidyBps -
            Math.mulDiv(
                expectedTargetLeverageBps,
                subsidyBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );

        // Do not use ceilDiv as we want to round down required debt repay amount in base currency
        // to avoid getting the new leverage below the target leverage, which will revert the
        // rebalance process (due to post-process assertion)
        // The logic is to repay a bit less, and withdraw a bit more collateral (due to rounding),
        // which will guarantee the new leverage cannot be less than the target leverage, avoid
        // unexpected post-process assertion revert.
        requiredDebtRepayAmountInBase =
            (totalCollateralBase *
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS -
                expectedTargetLeverageBps *
                (totalCollateralBase - totalDebtBase)) /
            denominator;

        return requiredDebtRepayAmountInBase;
    }

    /**
     * @dev Gets the collateral token amount to be withdraw to repay the debt token
     * @param inputDebtRepayAmountInBase The debt amount in base currency to be repaid
     * @param subsidyBps The subsidy in basis points unit
     * @return outputCollateralTokenAmount The collateral token amount to be withdraw
     */
    function _getCollateralWithdrawAmountInBaseToDecreaseLeverage(
        uint256 inputDebtRepayAmountInBase,
        uint256 subsidyBps
    ) internal pure returns (uint256 outputCollateralTokenAmount) {
        /**
         * The formula is:
         *      x = (1+k) * y
         *  <=> x = (1 + kk/ONE_HUNDRED_PERCENT_BPS) * y
         *  <=> x = (ONE_HUNDRED_PERCENT_BPS + kk) * y / ONE_HUNDRED_PERCENT_BPS
         *
         * where:
         *      - x is the collateral amount in base currency to be withdraw
         *      - y is the debt amount in base currency to be repaid
         *      - kk is the subsidy in basis points unit
         *
         * For more detail, check the comment in _getDebtRepayAmountInBaseToReachTargetLeverage()
         */

        // Use rounding up with mulDiv with Rounding.Ceil as we want to withdraw a bit more, to avoid
        // getting the new leverage below the target leverage, which will revert the
        // rebalance process (due to post-process assertion)
        // Withdraw a bit more collateral (rounding), given the same repay amount of debt token
        // means the new leverage should be higher than the actual leverage (with decimal without rounding)
        // As we calculate the estimated final leverage is reaching the target leverage,
        // if we round down, the new leverage can be less than the target leverage (given
        // the same repay amount of debt token), which will revert the rebalance process (due to post-process assertion)
        return
            Math.mulDiv(
                inputDebtRepayAmountInBase,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS + subsidyBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                Math.Rounding.Ceil
            );
    }

    /**
     * @dev Gets the rebalance amount to reach the target leverage in token unit
     *      - This method is supposed to be used by the rebalancing service which will use it to quote the required
     *        collateral/debt amount and the corresponding direction (increase or decrease)
     * @return inputTokenAmount The amount of token to call increaseLeverage or decreaseLeverage (in token unit)
     *         - If the direction is 1, the amount is in collateral token
     *         - If the direction is -1, the amount is in debt token
     * @return estimatedOutputTokenAmount The estimated output token amount after the rebalance (in token unit)
     *         - If the direction is 1, the amount is in debt token
     *         - If the direction is -1, the amount is in collateral token
     * @return direction The direction of the rebalance (1 for increase, -1 for decrease, 0 means no rebalance)
     */
    function quoteRebalanceAmountToReachTargetLeverage()
        public
        view
        returns (
            uint256 inputTokenAmount,
            uint256 estimatedOutputTokenAmount,
            int8 direction
        )
    {
        uint256 currentLeverageBps = getCurrentLeverageBps();
        uint256 subsidyBps = getCurrentSubsidyBps();
        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase
        ) = getTotalCollateralAndDebtOfUserInBase(address(this));

        if (totalCollateralBase == 0) {
            // No collateral means no debt and no leverage, so no rebalance is needed
            return (0, 0, 0);
        }

        // If the current leverage is below the target leverage, the user should increase the leverage
        if (currentLeverageBps < targetLeverageBps) {
            uint256 requiredCollateralDepositAmountInBase = _getCollateralTokenDepositAmountToReachTargetLeverage(
                    targetLeverageBps,
                    totalCollateralBase,
                    totalDebtBase,
                    subsidyBps
                );
            inputTokenAmount = convertFromBaseCurrencyToToken(
                requiredCollateralDepositAmountInBase,
                address(collateralToken)
            );
            uint256 receivedDebtBorrowAmountInBase = _getDebtBorrowAmountInBaseToIncreaseLeverage(
                    requiredCollateralDepositAmountInBase,
                    subsidyBps
                );
            estimatedOutputTokenAmount = convertFromBaseCurrencyToToken(
                receivedDebtBorrowAmountInBase,
                address(debtToken)
            );
            direction = 1;
            return (inputTokenAmount, estimatedOutputTokenAmount, direction);
        }
        // If the current leverage is above the target leverage, the user should decrease the leverage
        else if (currentLeverageBps > targetLeverageBps) {
            uint256 requiredDebtRepayAmountInBase = _getDebtRepayAmountInBaseToReachTargetLeverage(
                    targetLeverageBps,
                    totalCollateralBase,
                    totalDebtBase,
                    subsidyBps
                );
            inputTokenAmount = convertFromBaseCurrencyToToken(
                requiredDebtRepayAmountInBase,
                address(debtToken)
            );
            uint256 receivedCollateralWithdrawAmountInBase = _getCollateralWithdrawAmountInBaseToDecreaseLeverage(
                    requiredDebtRepayAmountInBase,
                    subsidyBps
                );
            estimatedOutputTokenAmount = convertFromBaseCurrencyToToken(
                receivedCollateralWithdrawAmountInBase,
                address(collateralToken)
            );
            direction = -1;
            return (inputTokenAmount, estimatedOutputTokenAmount, direction);
        }

        // If the current leverage is equal to the target leverage, the user should not rebalance
        return (0, 0, 0);
    }

    /**
     * @dev Increases the leverage of the user by supplying collateral token and borrowing more debt token
     *      - It requires to spend the collateral token from the user's wallet to supply to the pool
     *      - It will send the borrowed debt token to the user's wallet
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

        // Make sure the input collateral token amount is not zero
        if (inputCollateralTokenAmount == 0) {
            revert InputCollateralTokenAmountIsZero();
        }

        // Make sure only increase the leverage if it is below the target leverage
        uint256 currentLeverageBps = getCurrentLeverageBps();
        if (currentLeverageBps >= targetLeverageBps) {
            revert LeverageExceedsTarget(currentLeverageBps, targetLeverageBps);
        }

        // Calculate everything before transferring, supplying and borrowing to avoid
        // any potential impact from the child contract implementation

        // Calculate the amount of collateral token in base currency to deposit
        uint256 inputCollateralDepositAmountInBase = convertFromTokenAmountToBaseCurrency(
                inputCollateralTokenAmount,
                address(collateralToken)
            );

        // The amount of debt token to borrow is equal to the amount of collateral token deposited
        // plus the subsidy (bonus for the caller)
        uint256 borrowedDebtTokenInBase = _getDebtBorrowAmountInBaseToIncreaseLeverage(
                inputCollateralDepositAmountInBase,
                getCurrentSubsidyBps()
            );

        // Convert the amount of debt token in base currency to token unit
        uint256 borrowedDebtTokenAmount = convertFromBaseCurrencyToToken(
            borrowedDebtTokenInBase,
            address(debtToken)
        );

        // Transfer the input collateral token from the caller to the vault
        collateralToken.safeTransferFrom(
            msg.sender,
            address(this),
            inputCollateralTokenAmount
        );

        // Supply the collateral token to the lending pool
        uint256 suppliedCollateralTokenAmount = _supplyToPool(
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
            revert IncreaseLeverageReceiveLessThanMinAmount(
                actualBorrowedDebtTokenAmount,
                minReceivedDebtTokenAmount
            );
        }

        // Make sure new current leverage is increased and not above the target leverage
        uint256 newCurrentLeverageBps = getCurrentLeverageBps();
        if (
            newCurrentLeverageBps > targetLeverageBps ||
            newCurrentLeverageBps <= currentLeverageBps
        ) {
            revert IncreaseLeverageOutOfRange(
                newCurrentLeverageBps,
                targetLeverageBps,
                currentLeverageBps
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
            suppliedCollateralTokenAmount, // Supplied collateral token amount
            actualBorrowedDebtTokenAmount // Borrowed debt token amount
        );
    }

    /**
     * @dev Decreases the leverage of the user by repaying debt and withdrawing collateral
     *      - It requires to spend the debt token from the user's wallet to repay the debt to the pool
     *      - It will send the withdrawn collateral asset to the user's wallet
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

        // Make sure the input debt token amount is not zero
        if (inputDebtTokenAmount == 0) {
            revert InputDebtTokenAmountIsZero();
        }

        // Make sure only decrease the leverage if it is above the target leverage
        uint256 currentLeverageBps = getCurrentLeverageBps();
        if (currentLeverageBps <= targetLeverageBps) {
            revert LeverageBelowTarget(currentLeverageBps, targetLeverageBps);
        }

        // Calculate everything before transferring, repaying and withdrawing to avoid
        // any potential impact from the child contract implementation

        // Calculate the amount of debt token in base currency to repay
        uint256 inputDebtRepayAmountInBase = convertFromTokenAmountToBaseCurrency(
                inputDebtTokenAmount,
                address(debtToken)
            );

        // The amount of collateral asset to withdraw is equal to the amount of debt token repaid
        // plus the subsidy (bonus for the caller)
        uint256 withdrawCollateralTokenInBase = _getCollateralWithdrawAmountInBaseToDecreaseLeverage(
                inputDebtRepayAmountInBase,
                getCurrentSubsidyBps()
            );

        // Convert the amount of collateral token in base currency to token unit
        uint256 withdrawnCollateralTokenAmount = convertFromBaseCurrencyToToken(
            withdrawCollateralTokenInBase,
            address(collateralToken)
        );

        // Transfer the additional debt token from the caller to the vault
        debtToken.safeTransferFrom(
            msg.sender,
            address(this),
            inputDebtTokenAmount
        );

        // Repay the debt token to the lending pool
        _repayDebtToPool(
            address(debtToken),
            inputDebtTokenAmount,
            address(this)
        );

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
        if (
            actualWithdrawnCollateralTokenAmount <
            minReceivedCollateralTokenAmount
        ) {
            revert DecreaseLeverageReceiveLessThanMinAmount(
                actualWithdrawnCollateralTokenAmount,
                minReceivedCollateralTokenAmount
            );
        }

        // Make sure new current leverage is decreased and not below the target leverage
        uint256 newCurrentLeverageBps = getCurrentLeverageBps();
        if (
            newCurrentLeverageBps < targetLeverageBps ||
            newCurrentLeverageBps >= currentLeverageBps
        ) {
            revert DecreaseLeverageOutOfRange(
                newCurrentLeverageBps,
                targetLeverageBps,
                currentLeverageBps
            );
        }

        if (actualWithdrawnCollateralTokenAmount > 0) {
            // Transfer the collateral asset to the user
            collateralToken.safeTransfer(
                msg.sender,
                actualWithdrawnCollateralTokenAmount
            );
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
     * @dev Gets the current leverage in basis points
     * @return uint256 The current leverage in basis points
     */
    function getCurrentLeverageBps() public view returns (uint256) {
        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase
        ) = getTotalCollateralAndDebtOfUserInBase(address(this));

        if (totalCollateralBase < totalDebtBase) {
            revert CollateralLessThanDebt(totalCollateralBase, totalDebtBase);
        }
        if (totalCollateralBase == 0) {
            return 0;
        }
        if (totalCollateralBase == totalDebtBase) {
            return type(uint256).max; // infinite leverage
        }
        // The leverage will be 1 if totalDebtBase is 0 (no more debt)
        uint256 leverageBps = ((totalCollateralBase *
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
            (totalCollateralBase - totalDebtBase));
        if (leverageBps < BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert InvalidLeverage(leverageBps);
        }
        return leverageBps;
    }

    /**
     * @dev Gets the current subsidy in basis points
     * @return uint256 The current subsidy in basis points
     */
    function getCurrentSubsidyBps() public view returns (uint256) {
        uint256 currentLeverageBps = getCurrentLeverageBps();

        uint256 subsidyBps;
        if (currentLeverageBps > targetLeverageBps) {
            subsidyBps =
                ((currentLeverageBps - targetLeverageBps) *
                    BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
                targetLeverageBps;
        } else {
            subsidyBps =
                ((targetLeverageBps - currentLeverageBps) *
                    BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
                targetLeverageBps;
        }
        if (subsidyBps > maxSubsidyBps) {
            return maxSubsidyBps;
        }
        return subsidyBps;
    }

    /**
     * @dev Gets the address of the collateral token
     * @return address The address of the collateral token
     */
    function getCollateralTokenAddress() public view returns (address) {
        return address(collateralToken);
    }

    /**
     * @dev Gets the address of the debt token
     * @return address The address of the debt token
     */
    function getDebtTokenAddress() public view returns (address) {
        return address(debtToken);
    }

    /**
     * @dev Gets the default maximum subsidy in basis points
     * @return uint256 The default maximum subsidy in basis points
     */
    function getDefaultMaxSubsidyBps() public view returns (uint256) {
        return maxSubsidyBps;
    }

    /* Admin */

    /**
     * @dev Sets the maximum subsidy in basis points
     * @param _maxSubsidyBps New maximum subsidy in basis points
     */
    function setMaxSubsidyBps(
        uint256 _maxSubsidyBps
    ) public onlyOwner nonReentrant {
        maxSubsidyBps = _maxSubsidyBps;
        emit MaxSubsidyBpsSet(_maxSubsidyBps);
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
        if (
            _lowerBoundTargetLeverageBps >= targetLeverageBps ||
            targetLeverageBps >= _upperBoundTargetLeverageBps
        ) {
            revert InvalidLeverageBounds(
                _lowerBoundTargetLeverageBps,
                targetLeverageBps,
                _upperBoundTargetLeverageBps
            );
        }

        lowerBoundTargetLeverageBps = _lowerBoundTargetLeverageBps;
        upperBoundTargetLeverageBps = _upperBoundTargetLeverageBps;

        emit LeverageBoundsSet(
            _lowerBoundTargetLeverageBps,
            _upperBoundTargetLeverageBps
        );
    }

    /* Overrides to add leverage check */

    function maxDeposit(address _user) public view override returns (uint256) {
        // Don't allow deposit if the leverage is too imbalanced
        if (isTooImbalanced()) {
            return 0;
        }
        return super.maxDeposit(_user);
    }

    function maxMint(address _user) public view override returns (uint256) {
        // Don't allow mint if the leverage is too imbalanced
        if (isTooImbalanced()) {
            return 0;
        }
        return super.maxMint(_user);
    }

    function maxWithdraw(address _user) public view override returns (uint256) {
        // Don't allow withdraw if the leverage is too imbalanced
        if (isTooImbalanced()) {
            return 0;
        }
        return super.maxWithdraw(_user);
    }

    function maxRedeem(address _user) public view override returns (uint256) {
        // Don't allow redeem if the leverage is too imbalanced
        if (isTooImbalanced()) {
            return 0;
        }
        return super.maxRedeem(_user);
    }
}
