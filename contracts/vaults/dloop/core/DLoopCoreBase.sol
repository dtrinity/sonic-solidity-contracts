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
import {CoreLogic} from "./CoreLogic.sol";
import {Compare} from "contracts/common/Compare.sol";

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
    error ZeroShares();

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
        if (
            !Compare.isWithinTolerance(
                observedDiffSupply,
                amount,
                BALANCE_DIFF_TOLERANCE
            )
        ) {
            revert UnexpectedSupplyAmountToPool(
                token,
                tokenBalanceBeforeSupply,
                tokenBalanceAfterSupply,
                amount
            );
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
        if (
            !Compare.isWithinTolerance(
                observedDiffBorrow,
                amount,
                BALANCE_DIFF_TOLERANCE
            )
        ) {
            revert UnexpectedBorrowAmountFromPool(
                token,
                tokenBalanceBeforeBorrow,
                tokenBalanceAfterBorrow,
                amount
            );
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
        if (
            !Compare.isWithinTolerance(
                observedDiffRepay,
                amount,
                BALANCE_DIFF_TOLERANCE
            )
        ) {
            revert UnexpectedRepayAmountToPool(
                token,
                tokenBalanceBeforeRepay,
                tokenBalanceAfterRepay,
                amount
            );
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
        if (
            !Compare.isWithinTolerance(
                observedDiffWithdraw,
                amount,
                BALANCE_DIFF_TOLERANCE
            )
        ) {
            revert UnexpectedWithdrawAmountFromPool(
                token,
                tokenBalanceBeforeWithdraw,
                tokenBalanceAfterWithdraw,
                amount
            );
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
            CoreLogic.getLeveragedAssetsWithLeverage(assets, targetLeverageBps);
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
            CoreLogic.getLeveragedAssetsWithLeverage(
                assets,
                getCurrentLeverageBps()
            );
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
            CoreLogic.getUnleveragedAssetsWithLeverage(
                leveragedAssets,
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
            CoreLogic.getUnleveragedAssetsWithLeverage(
                leveragedAssets,
                getCurrentLeverageBps()
            );
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
        return
            CoreLogic.convertFromBaseCurrencyToToken(
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
    function convertFromTokenAmountToBaseCurrency(
        uint256 amountInToken,
        address token
    ) public view returns (uint256) {
        return
            CoreLogic.convertFromTokenAmountToBaseCurrency(
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
        return
            CoreLogic.isTooImbalanced(
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
        if (
            collateralToken.allowance(caller, address(this)) < supplyAssetAmount
        ) {
            revert InsufficientAllowanceOfCollateralAssetToSupply(
                caller,
                address(this),
                address(collateralToken),
                supplyAssetAmount
            );
        }

        // Transfer the assets to the vault (need the allowance before calling this function)
        collateralToken.safeTransferFrom(
            caller,
            address(this),
            supplyAssetAmount
        );

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
        uint256 debtTokenAmountToBorrow = CoreLogic
            .getBorrowAmountThatKeepCurrentLeverage(
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

        return borrowedDebtTokenAmount;
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
        // Get current leverage before transferring, repaying and withdrawing
        // to avoid unexpected impact from the child contract implementation
        // IMPORTANT: this is the leverage before repaying the debt
        uint256 leverageBpsBeforeRepayDebt = getCurrentLeverageBps();

        // Get the amount of debt token to repay to keep the current leverage
        repaidDebtTokenAmount = CoreLogic.getRepayAmountThatKeepCurrentLeverage(
            collateralTokenToWithdraw,
            leverageBpsBeforeRepayDebt,
            ERC20(collateralToken).decimals(),
            getAssetPriceFromOracle(address(collateralToken)),
            ERC20(debtToken).decimals(),
            getAssetPriceFromOracle(address(debtToken))
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
        // Update the repaid debt token amount to the actual amount as this
        // variable is also the return value of this function
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

    /* Rebalance */

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
        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase
        ) = getTotalCollateralAndDebtOfUserInBase(address(this));

        return
            CoreLogic.quoteRebalanceAmountToReachTargetLeverage(
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

        // Make sure only increase the leverage if it is below the target leverage
        uint256 currentLeverageBpsBeforeIncreaseLeverage = getCurrentLeverageBps();
        if (currentLeverageBpsBeforeIncreaseLeverage >= targetLeverageBps) {
            revert LeverageExceedsTarget(
                currentLeverageBpsBeforeIncreaseLeverage,
                targetLeverageBps
            );
        }

        // Get the amount of debt token to borrow to increase the leverage, given the input collateral token amount
        uint256 borrowedDebtTokenAmount = CoreLogic
            .getDebtBorrowTokenAmountToIncreaseLeverage(
                inputCollateralTokenAmount,
                getCurrentSubsidyBps(),
                ERC20(collateralToken).decimals(),
                getAssetPriceFromOracle(address(collateralToken)),
                ERC20(debtToken).decimals(),
                getAssetPriceFromOracle(address(debtToken))
            );

        // Transfer the input collateral token from the caller to the vault
        collateralToken.safeTransferFrom(
            msg.sender,
            address(this),
            inputCollateralTokenAmount
        );

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
            revert IncreaseLeverageReceiveLessThanMinAmount(
                actualBorrowedDebtTokenAmount,
                minReceivedDebtTokenAmount
            );
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

        // Make sure only decrease the leverage if it is above the target leverage
        uint256 currentLeverageBps = getCurrentLeverageBps();
        if (currentLeverageBps <= targetLeverageBps) {
            revert LeverageBelowTarget(currentLeverageBps, targetLeverageBps);
        }

        // Get the amount of collateral token to withdraw to decrease the leverage, given the input debt token amount
        uint256 withdrawnCollateralTokenAmount = CoreLogic
            .getCollateralWithdrawTokenAmountToDecreaseLeverage(
                inputDebtTokenAmount,
                getCurrentSubsidyBps(),
                ERC20(collateralToken).decimals(),
                getAssetPriceFromOracle(address(collateralToken)),
                ERC20(debtToken).decimals(),
                getAssetPriceFromOracle(address(debtToken))
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

        return
            CoreLogic.getCurrentLeverageBps(totalCollateralBase, totalDebtBase);
    }

    /**
     * @dev Gets the current subsidy in basis points
     * @return uint256 The current subsidy in basis points
     */
    function getCurrentSubsidyBps() public view returns (uint256) {
        return
            CoreLogic.getCurrentSubsidyBps(
                getCurrentLeverageBps(),
                targetLeverageBps,
                maxSubsidyBps
            );
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
