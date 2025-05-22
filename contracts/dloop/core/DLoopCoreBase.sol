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
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Erc20Helper} from "../libraries/Erc20Helper.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
/**
 * @title DLoopCoreBase
 * @dev A leveraged vault contract
 */
abstract contract DLoopCoreBase is ERC4626, Ownable, ReentrancyGuard {
    using Math for uint256;
    using SafeERC20 for ERC20;

    /* Core state */

    uint32 public lowerBoundTargetLeverageBps;
    uint32 public upperBoundTargetLeverageBps;
    uint256 private _defaultMaxSubsidyBps;

    /* Constants */
    address public immutable BASE_CURRENCY;
    uint8 public immutable PRICE_ORACLE_DECIMALS;
    uint256 public immutable PRICE_ORACLE_UNIT;
    uint32 public immutable TARGET_LEVERAGE_BPS; // ie. 30000 = 300% over 100% in basis points, means 3x leverage
    ERC20 public immutable underlyingAsset;
    ERC20 public immutable dStable;

    /* Errors */

    error RestrictedRescueTokenIsNotERC20(address token);
    error TooImbalanced(
        uint256 currentLeverageBps,
        uint256 lowerBoundTargetLeverageBps,
        uint256 upperBoundTargetLeverageBps
    );
    error InvalidTotalSupplyAndAssets(uint256 totalAssets, uint256 totalSupply);
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
    error InvalidMaxWithdrawAfterRepay(
        address token,
        uint256 maxWithdrawUnderlyingBeforeRepay,
        uint256 maxWithdrawUnderlyingAfterRepay
    );
    error WithdrawableIsLessThanRequired(
        address token,
        uint256 assetToRemoveFromLending,
        uint256 withdrawableAmount
    );
    error ExceedMaxPrice(uint256 assetPrice, uint256 maxPrice);
    error BelowMinPrice(uint256 assetPrice, uint256 minPrice);
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
    error MaxDStableToBorrowNotIncreasedAfterSupply(
        uint256 maxDStableToBorrowBeforeSupply,
        uint256 maxDStableToBorrowAfterSupply
    );
    error DStableDecreasedAfterBorrow(
        uint256 dStableBalanceBeforeBorrow,
        uint256 dStableBalanceAfterBorrow,
        uint256 dStableAmountToBorrow
    );
    error UnderlyingAssetDecreasedAfterWithdraw(
        uint256 underlyingAssetBalanceBefore,
        uint256 underlyingAssetBalanceAfter,
        uint256 withdrawableUnderlyingAmount
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

    /**
     * @dev Constructor for the DLoopCore contract
     * @param _name Name of the vault token
     * @param _symbol Symbol of the vault token
     * @param _underlyingAsset Address of the underlying asset
     * @param _dStable Address of the dStable token
     * @param _targetLeverageBps Target leverage in basis points
     * @param _lowerBoundTargetLeverageBps Lower bound of target leverage in basis points
     * @param _upperBoundTargetLeverageBps Upper bound of target leverage in basis points
     * @param _maxSubsidyBps Maximum subsidy in basis points
     * @param _baseCurrency Address of the base currency
     * @param _priceOracleDecimals Decimals of the price oracle (ie, 8 means 10^8 units of the asset)
     */
    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _underlyingAsset,
        ERC20 _dStable,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps,
        address _baseCurrency,
        uint8 _priceOracleDecimals
    ) ERC20(_name, _symbol) ERC4626(_underlyingAsset) Ownable(msg.sender) {
        dStable = _dStable;
        underlyingAsset = _underlyingAsset;

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

        // Make sure underlying asset is ERC-20
        if (!Erc20Helper.isERC20(address(_underlyingAsset))) {
            revert("Underlying asset must be an ERC-20");
        }

        // Make sure dStable is ERC-20
        if (!Erc20Helper.isERC20(address(_dStable))) {
            revert("dStable must be an ERC-20");
        }

        BASE_CURRENCY = _baseCurrency;
        PRICE_ORACLE_DECIMALS = _priceOracleDecimals;
        PRICE_ORACLE_UNIT = 10 ** _priceOracleDecimals;
        TARGET_LEVERAGE_BPS = _targetLeverageBps;
        lowerBoundTargetLeverageBps = _lowerBoundTargetLeverageBps;
        upperBoundTargetLeverageBps = _upperBoundTargetLeverageBps;
        _defaultMaxSubsidyBps = _maxSubsidyBps;
    }

    /* Virtual Methods - Required to be implemented by derived contracts */

    /**
     * @dev Gets the restricted rescue tokens
     * @return address[] Restricted rescue tokens
     */
    function getRestrictedRescueTokens() public view virtual returns (address[] memory);

    /**
     * @dev Gets the asset price from the oracle
     * @param asset Address of the asset
     * @return uint256 Price of the asset
     */
    function getAssetPriceFromOracleImplementation(
        address asset
    ) public view virtual returns (uint256);

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

    /**
     * @dev Gets the total collateral and debt of a user in base currency
     * @param user Address of the user
     * @return totalCollateralBase Total collateral in base currency
     * @return totalDebtBase Total debt in base currency
     */
    function _getTotalCollateralAndDebtOfUserInBase(
        address user
    )
        internal
        view
        virtual
        returns (uint256 totalCollateralBase, uint256 totalDebtBase);

    /**
     * @dev Gets the maximum withdrawable token amount of a user from the lending pool
     * @param user Address of the user
     * @param token Address of the token
     * @return uint256 Maximum withdrawable token amount
     */
    function _getMaxWithdrawableAmount(
        address user,
        address token
    ) internal view virtual returns (uint256);

    /**
     * @dev Gets the maximum borrowable amount of a token
     * @param user Address of the user
     * @param token Address of the token
     * @return uint256 Maximum borrowable amount of the token
     */
    function _getMaxBorrowableAmount(
        address user,
        address token
    ) internal view virtual returns (uint256);

    /* Wrapper Functions */

    /**
     * @dev Supply tokens to the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to supply
     * @param onBehalfOf Address to supply on behalf of
     */
    function _supplyToPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeSupply = ERC20(token).balanceOf(address(this));

        _supplyToPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterSupply = ERC20(token).balanceOf(address(this));
        if (tokenBalanceAfterSupply >= tokenBalanceBeforeSupply) {
            revert TokenBalanceNotDecreasedAfterSupply(token, tokenBalanceBeforeSupply, tokenBalanceAfterSupply, amount);
        }

        // Now, as balance before must be greater than balance after, we can just check if the difference is the expected amount
        if (tokenBalanceBeforeSupply - tokenBalanceAfterSupply != amount) {
            revert UnexpectedSupplyAmountToPool(token, tokenBalanceBeforeSupply, tokenBalanceAfterSupply, amount);
        }
    }

    /**
     * @dev Borrow tokens from the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to borrow
     * @param onBehalfOf Address to borrow on behalf of
     */
    function _borrowFromPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeBorrow = ERC20(token).balanceOf(address(this));

        _borrowFromPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterBorrow = ERC20(token).balanceOf(address(this));
        if (tokenBalanceAfterBorrow <= tokenBalanceBeforeBorrow) {
            revert TokenBalanceNotIncreasedAfterBorrow(token, tokenBalanceBeforeBorrow, tokenBalanceAfterBorrow, amount);
        }

        // Now, as balance before must be less than balance after, we can just check if the difference is the expected amount
        if (tokenBalanceAfterBorrow - tokenBalanceBeforeBorrow != amount) {
            revert UnexpectedBorrowAmountFromPool(token, tokenBalanceBeforeBorrow, tokenBalanceAfterBorrow, amount);
        }
    }

    /**
     * @dev Repay debt to the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to repay
     * @param onBehalfOf Address to repay on behalf of
     */
    function _repayDebtToPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeRepay = ERC20(token).balanceOf(address(this));

        _repayDebtToPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterRepay = ERC20(token).balanceOf(address(this));

        if (tokenBalanceAfterRepay >= tokenBalanceBeforeRepay) {
            revert TokenBalanceNotDecreasedAfterRepay(token, tokenBalanceBeforeRepay, tokenBalanceAfterRepay, amount);
        }

        // Now, as balance before must be greater than balance after, we can just check if the difference is the expected amount
        if (tokenBalanceBeforeRepay - tokenBalanceAfterRepay != amount) {
            revert UnexpectedRepayAmountToPool(token, tokenBalanceBeforeRepay, tokenBalanceAfterRepay, amount);
        }
    }

    /**
     * @dev Withdraw tokens from the lending pool, and make sure the output is as expected
     * @param token Address of the token
     * @param amount Amount of tokens to withdraw
     * @param onBehalfOf Address to withdraw on behalf of
     */
    function _withdrawFromPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal {
        // At this step, we assume that the funds from the depositor are already in the vault

        uint256 tokenBalanceBeforeWithdraw = ERC20(token).balanceOf(address(this));

        _withdrawFromPoolImplementation(token, amount, onBehalfOf);

        uint256 tokenBalanceAfterWithdraw = ERC20(token).balanceOf(address(this));

        if (tokenBalanceAfterWithdraw <= tokenBalanceBeforeWithdraw) {
            revert TokenBalanceNotIncreasedAfterWithdraw(token, tokenBalanceBeforeWithdraw, tokenBalanceAfterWithdraw, amount);
        }

        // Now, as balance before must be less than balance after, we can just check if the difference is the expected amount
        if (tokenBalanceAfterWithdraw - tokenBalanceBeforeWithdraw != amount) {
            revert UnexpectedWithdrawAmountFromPool(token, tokenBalanceBeforeWithdraw, tokenBalanceAfterWithdraw, amount);
        }
    }

    /* Helper Functions */

    /**
     * @dev Gets the asset price from the oracle
     * @param asset Address of the asset
     * @return uint256 Price of the asset
     */
    function getAssetPriceFromOracle(
        address asset
    ) public view returns (uint256) {
        uint256 assetPrice = getAssetPriceFromOracleImplementation(asset);

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
        return (amountInBase * 10 ** ERC20(token).decimals()) / tokenPriceInBase;
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
        return (amountInToken * tokenPriceInBase) / 10 ** ERC20(token).decimals();
    }

    /**
     * @dev Calculates the leveraged amount of the assets
     * @param assets Amount of assets
     * @return leveragedAssets Amount of leveraged assets
     */
    function getLeveragedAssets(uint256 assets) public view returns (uint256) {
        return
            (assets * TARGET_LEVERAGE_BPS) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
    }

    /**
     * @dev Gets the amount of dStable to repay when withdrawing the underlying asset
     * @param assets Amount of underlying asset to withdraw
     * @return amountOfDebtToRepay Amount of dStable to repay
     */
    function getAmountOfDebtToRepay(
        uint256 assets
    ) public view returns (uint256) {
        return
            (assets *
                (getAssetPriceFromOracle(address(underlyingAsset)) *
                    10 ** dStable.decimals())) /
            (getAssetPriceFromOracle(address(dStable)) *
                10 ** underlyingAsset.decimals());
    }

    /**
     * @dev Override of totalAssets from ERC4626
     * @return uint256 Total assets in the vault
     */
    function totalAssets() public view virtual override returns (uint256) {
        // We override this function to return the total assets in the vault
        // with respect to the position in the lending pool
        // The dLend interest will be distributed to the dToken
        (
            uint256 totalCollateralBase,

        ) = _getTotalCollateralAndDebtOfUserInBase(address(this));
        // The price decimals is cancelled out in the division (as the amount and price are in the same unit)
        return convertFromBaseCurrencyToToken(totalCollateralBase, address(underlyingAsset));
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

    /**
     * @dev Rescues tokens accidentally sent to the contract (except for the underlying asset and dStable)
     * @param token Address of the token to rescue
     * @param receiver Address to receive the rescued tokens
     * @param amount Amount of tokens to rescue
     */
    function rescueToken(address token, address receiver, uint256 amount) public onlyOwner nonReentrant {
        // The vault does not hold any dStable and underlying asset, so it is not necessary to restrict the rescue of dStable and underlying asset
        // We can just rescue any ERC-20 token

        address[] memory restrictedRescueTokens = getRestrictedRescueTokens();

        // Check if the token is restricted
        for (uint256 i = 0; i < restrictedRescueTokens.length; i++) {
            if (token == restrictedRescueTokens[i]) {
                revert("Cannot rescue restricted token");
            }
        }

        // Rescue the token
        ERC20(token).safeTransfer(
            receiver,
            amount
        );
    }

    /* Deposit and Mint */

    /**
     * @dev Deposits assets into the vault
     *      - It will send the borrowed dStable and the minted shares to the receiver
     *      - The minted shares represent the position of the supplied assets in the lending pool
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
        /**
         * Example of how this function works:
         * 
         * Suppose that the target leverage is 3x, and the baseLTVAsCollateral is 70%
         * - The collateral token is WETH
         * - The dSTABLE debt here is dUSD
         * - The current shares supply is 0
         * 
         * 1. User deposits 300 WETH
         * 2. The vault supplies 300 WETH to the lending pool
         * 3. The vault borrows 210 dUSD (300 * 70%) from the lending pool
         * 4. The vault sends 210 dUSD to the receiver
         * 5. The vault mints 300 shares to the user (representing 300 WETH position in the lending pool)
         */

        // Make sure the current leverage is within the target range
        if (isTooImbalanced()) {
            revert TooImbalanced(
                getCurrentLeverageBps(),
                lowerBoundTargetLeverageBps,
                upperBoundTargetLeverageBps
            );
        }

        // Transfer the assets to the vault (need the allowance before calling this function)
        underlyingAsset.safeTransferFrom(
            caller,
            address(this),
            assets
        );

        uint256 dStableBorrowed = _depositToPoolImplementation(assets);

        // Transfer the dStable to the receiver
        dStable.safeTransfer(receiver, dStableBorrowed);

        // Mint the vault's shares to the depositor
        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    /**
     * @dev Deposits assets into the lending pool
     * @param depositAssetAmount Amount of assets to deposit
     * @return dStableAmountToBorrow Amount of dStable to borrow
     */
    function _depositToPoolImplementation(
        uint256 depositAssetAmount // deposit amount
    ) private returns (uint256) {
        // At this step, we assume that the funds from the depositor are already in the vault

        // Get current leverage before supplying (IMPORTANT: this is the leverage before supplying)
        uint256 currentLeverageBpsBeforeSupply = getCurrentLeverageBps();

        // Make sure we have enough balance to supply before supplying
        uint256 currentUnderlyingAssetBalance = underlyingAsset.balanceOf(
            address(this)
        );
        if (currentUnderlyingAssetBalance < depositAssetAmount) {
            revert DepositInsufficientToSupply(
                currentUnderlyingAssetBalance,
                depositAssetAmount
            );
        }

        // Supply the underlying asset to the lending pool
        _supplyToPool(address(underlyingAsset), depositAssetAmount, address(this));

        // Get the amount of dStable to borrow that keeps the current leverage
        // If there is no deposit yet (leverage=0), we use the target leverage
        uint256 dStableAmountToBorrow = getBorrowAmountThatKeepCurrentLeverage(
            address(underlyingAsset),
            address(dStable),
            depositAssetAmount,
            currentLeverageBpsBeforeSupply > 0
                ? currentLeverageBpsBeforeSupply
                : TARGET_LEVERAGE_BPS
        );

        // Borrow the max amount of dStable
        _borrowFromPool(address(dStable), dStableAmountToBorrow, address(this));

        return dStableAmountToBorrow;
    }

    /* Withdraw and Redeem */

    /**
     * @dev Withdraws assets from the vault
     *      - It requires to spend the dSTABLE to repay the debt
     *      - It will send the withdrawn underlying assets to the receiver and burn the shares
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
         * - The dSTABLE debt here is dUSD
         * - The current shares supply is 300
         * 
         * 1. User has 100 shares
         * 2. User wants to withdraw 100 WETH
         * 3. The vault burns 100 shares
         * 4. The vault transfers 70 dUSD (100 * 70%) from the user to the vault
         * 5. The vault repays 70 dUSD to the lending pool
         * 6. The vault withdraws 100 WETH from the lending pool
         * 7. The vault sends 100 WETH to the receiver
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

        // Calculate dStable to repay
        uint256 dStableToRepay = getAmountOfDebtToRepay(assets);

        // If don't have enough allowance, revert with the error message
        // This is to early-revert with instruction in the error message
        if (dStable.allowance(msg.sender, address(this)) < dStableToRepay) {
            revert InsufficientAllowanceOfDebtAssetToRepay(msg.sender, address(this), address(dStable), dStableToRepay);
        }

        // Transfer the dStable to the vault to repay the debt
        dStable.safeTransferFrom(msg.sender, address(this), dStableToRepay);

        // Withdraw the collateral from the lending pool
        uint256 withdrawnAssetsAmount = _withdrawFromPoolImplementation(
            assets,
            dStableToRepay
        );

        // Transfer the asset to the receiver
        underlyingAsset.safeTransfer(receiver, withdrawnAssetsAmount);

        emit Withdraw(
            caller,
            receiver,
            owner,
            withdrawnAssetsAmount,
            shares
        );
    }

    /**
     * @dev Handles the logic for repaying debt and withdrawing collateral from the pool, then transfers to receiver
     * @param assetsToRemoveFromLending The acutal amount of assets to remove from the lending pool
     * @param dStableToRepay The amount of dStable to repay
     * @return receivedUnderlyingAmount The actual amount of underlying asset received and transferred to receiver
     */
    function _withdrawFromPoolImplementation(
        uint256 assetsToRemoveFromLending,
        uint256 dStableToRepay
    ) private returns (uint256 receivedUnderlyingAmount) {
        // Get the current leverage before repaying the debt (IMPORTANT: this is the leverage before repaying the debt)
        // It is used to calculate the expected withdrawable amount that keeps the current leverage
        uint256 leverageBpsBeforeRepayDebt = getCurrentLeverageBps();

        // Repay the debt to withdraw the collateral
        _repayDebtToPool(address(dStable), dStableToRepay, address(this));

        // Get the withdrawable amount that keeps the current leverage
        uint256 withdrawableUnderlyingAmount = getWithdrawAmountThatKeepCurrentLeverage(
            address(underlyingAsset),
            address(dStable),
            dStableToRepay,
            leverageBpsBeforeRepayDebt
        );

        if (withdrawableUnderlyingAmount < assetsToRemoveFromLending) {
            revert WithdrawableIsLessThanRequired(
                address(underlyingAsset),
                assetsToRemoveFromLending,
                withdrawableUnderlyingAmount
            );
        }

        // Withdraw the collateral
        _withdrawFromPool(
            address(underlyingAsset),
            withdrawableUnderlyingAmount,
            address(this)
        );

        return withdrawableUnderlyingAmount;
    }

    /**
     * @dev Gets the withdrawable amount that keeps the current leverage
     * @param collateralAsset The collateral asset
     * @param debtAsset The debt asset
     * @param repaidDebtAmount The actual repaid amount
     * @param leverageBpsBeforeRepayDebt Leverage in basis points before repaying
     * @return expectedWithdrawAmount The expected withdrawable amount that keeps the current leverage
     */
    function getWithdrawAmountThatKeepCurrentLeverage(
        address collateralAsset,
        address debtAsset,
        uint256 repaidDebtAmount,
        uint256 leverageBpsBeforeRepayDebt
    ) public view returns (uint256 expectedWithdrawAmount) {
        // Formula definition:
        // - C1: totalCollateralBase before repay
        // - D1: totalDebtBase before repay
        // - C2: totalCollateralBase after repay
        // - D2: totalDebtBase after repay
        // - T: target leverage
        // - x: withdraw amount
        // - y: repay amount
        //
        // We have:
        //        C1 / (C1-D1) = C2 / (C2-D2)
        //        C2 = C1-x
        //        D2 = D1-y
        //        C1 / (C1-D1) = T <=> C1 = (C1-D1) * T <=> C1 = C1*T - D1*T <=> C1*T - C1 = D1*T <=> C1 = D1*T/(T-1)
        //
        // Formula expression:
        //        C1 / (C1-D1) = (C1-x) / (C1-x-D1+y)
        //    <=> C1 * (C1-x-D1+y) = (C1-x) * (C1-D1)
        //    <=> C1^2 - C1*x - C1*D1 + C1*y = C1^2 - C1*D1 - C1*x + D1*x
        //    <=> C1^2 - C1*x - C1*D1 + C1*y = C1^2 - C1*x - C1*D1 + D1*x
        //    <=> C1*y = x*D1
        //    <=> y = x*D1 / C1
        //    <=> y = x*D1 / [D1*T / (T-1)]
        //    <=> y = x * (T-1)/T
        //    <=> x = y * T/(T-1)
        //

        // Instead of using TARGET_LEVERAGE_BPS, we use the current leverage to calculate the withdrawable amount to avoid
        // unexpectedly changing the current leverage (which may cause loss to the user)
        if (
            leverageBpsBeforeRepayDebt <=
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
        ) {
            // If there is no more debt, withdraw as much as possible
            return type(uint256).max;
        }

        // Convert the actual repaid amount to base
        uint256 repaidDebtAmountInBase = convertFromTokenAmountToBaseCurrency(repaidDebtAmount, debtAsset);

        // Calculate the expected withdrawable amount in base
        uint256 withdrawableAmountInBase = (repaidDebtAmountInBase * leverageBpsBeforeRepayDebt) /
            (leverageBpsBeforeRepayDebt -
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS);

        return convertFromBaseCurrencyToToken(withdrawableAmountInBase, collateralAsset);
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
        // Formula definition:
        // - C1: totalCollateralBase before supply
        // - D1: totalDebtBase before supply
        // - C2: totalCollateralBase after supply   
        // - D2: totalDebtBase after supply
        // - T: target leverage
        // - x: supply amount
        // - y: borrow amount
        //
        // We have:
        //        C1 / (C1-D1) = C2 / (C2-D2)
        //        C2 = C1+x
        //        D2 = D1+y
        //        C1 / (C1-D1) = T <=> C1 = (C1-D1) * T <=> C1 = C1*T - D1*T <=> C1*T - C1 = D1*T <=> C1 = D1*T/(T-1)
        //
        // Formula expression:
        //        C1 / (C1-D1) = (C1+x) / (C1+x-D1-y)
        //    <=> C1 * (C1+x-D1-y) = (C1+x) * (C1-D1)
        //    <=> C1^2 + C1*x - C1*D1 - C1*y = C1^2 - C1*D1 + C1*x - D1*x
        //    <=> C1*y = x*D1
        //    <=> y = x*D1 / C1
        //    <=> y = x * (T-1)/T
        //    <=> x = y * T/(T-1)
        //

        // Instead of using TARGET_LEVERAGE_BPS, we use the current leverage to calculate the borrowable amount to avoid
        // unexpectedly changing the current leverage (which may cause loss to the user)
        if (
            leverageBpsBeforeSupply <=
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
        ) {
            // If there is no more debt, borrow as much as possible
            return type(uint256).max;
        }

        // Convert the actual supplied amount to base
        uint256 suppliedCollateralAmountInBase = convertFromTokenAmountToBaseCurrency(suppliedCollateralAmount, collateralAsset);

        // Calculate the borrow amount in base currency that keeps the current leverage
        uint256 borrowAmountInBase = (suppliedCollateralAmountInBase * leverageBpsBeforeSupply) /
            (leverageBpsBeforeSupply -
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS);

        return convertFromBaseCurrencyToToken(borrowAmountInBase, debtAsset);
    }

    /* Rebalance */

    /**
     * @dev Increases the leverage of the user by supplying assets and borrowing more dStable
     * @param assetAmount The amount of asset to supply
     * @param minPriceInBase The minimum price of the asset in base currency
     */
    function increaseLeverage(
        uint256 assetAmount,
        uint256 minPriceInBase
    ) public nonReentrant {
        uint256 assetPriceInBase = getAssetPriceFromOracle(
            address(underlyingAsset)
        );
        if (assetPriceInBase < minPriceInBase) {
            revert BelowMinPrice(assetPriceInBase, minPriceInBase);
        }

        uint256 assetAmountInBase = convertFromTokenAmountToBaseCurrency(assetAmount, address(underlyingAsset));

        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase
        ) = _getTotalCollateralAndDebtOfUserInBase(address(this));

        uint256 borrowedDStableInBase = (assetAmountInBase *
            (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS + getCurrentSubsidyBps())) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        uint256 newLeverageBps = ((totalCollateralBase + assetAmountInBase) *
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
            (totalCollateralBase +
                assetAmountInBase -
                totalDebtBase -
                borrowedDStableInBase);

        uint256 currentLeverageBps = getCurrentLeverageBps();

        if (
            newLeverageBps > TARGET_LEVERAGE_BPS ||
            newLeverageBps <= currentLeverageBps
        ) {
            revert IncreaseLeverageOutOfRange(
                newLeverageBps,
                TARGET_LEVERAGE_BPS,
                currentLeverageBps
            );
        }

        // Transfer the asset to the vault to supply
        underlyingAsset.safeTransferFrom(
            msg.sender,
            address(this),
            assetAmount
        );

        // Supply the asset to the lending pool
        _supplyToPool(address(underlyingAsset), assetAmount, address(this));

        // Borrow more dStable
        uint256 borrowedDStable = convertFromBaseCurrencyToToken(borrowedDStableInBase, address(dStable));

        _borrowFromPool(address(dStable), borrowedDStable, address(this));

        // Transfer the dStable to the user
        dStable.safeTransfer(msg.sender, borrowedDStable);
    }

    /**
     * @dev Decreases the leverage of the user by withdrawing assets and repaying dStable
     * @param dStableAmount The amount of dStable to repay
     * @param maxPriceInBase The maximum price of the asset in base currency
     */
    function decreaseLeverage(
        uint256 dStableAmount,
        uint256 maxPriceInBase
    ) public nonReentrant {
        uint256 assetPriceInBase = getAssetPriceFromOracle(
            address(underlyingAsset)
        );
        if (assetPriceInBase > maxPriceInBase) {
            revert ExceedMaxPrice(assetPriceInBase, maxPriceInBase);
        }

        uint256 dStableAmountInBase = convertFromTokenAmountToBaseCurrency(dStableAmount, address(dStable));

        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase
        ) = _getTotalCollateralAndDebtOfUserInBase(address(this));

        uint256 currentSubsidyBps = getCurrentSubsidyBps();
        uint256 withdrawnAssetsBase = (dStableAmountInBase *
            (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS + currentSubsidyBps)) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        uint256 newLeverageBps = ((totalCollateralBase - withdrawnAssetsBase) *
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
            (totalCollateralBase -
                withdrawnAssetsBase -
                totalDebtBase +
                dStableAmountInBase);

        uint256 currentLeverageBps = getCurrentLeverageBps();
        if (
            newLeverageBps < TARGET_LEVERAGE_BPS ||
            newLeverageBps >= currentLeverageBps
        ) {
            revert DecreaseLeverageOutOfRange(
                newLeverageBps,
                TARGET_LEVERAGE_BPS,
                currentLeverageBps
            );
        }

        // Transfer the dStable to the vault to repay the debt
        dStable.safeTransferFrom(msg.sender, address(this), dStableAmount);

        _repayDebtToPool(address(dStable), dStableAmount, address(this));

        // Withdraw collateral
        uint256 withdrawnAssets = convertFromBaseCurrencyToToken(withdrawnAssetsBase, address(underlyingAsset));

        _withdrawFromPool(
            address(underlyingAsset),
            withdrawnAssets,
            address(this)
        );

        // Transfer the withdrawn assets to the user
        underlyingAsset.safeTransfer(msg.sender, withdrawnAssets);
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
        ) = _getTotalCollateralAndDebtOfUserInBase(address(this));

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
        return ((totalCollateralBase *
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
            (totalCollateralBase - totalDebtBase));
    }

    /**
     * @dev Gets the current subsidy in basis points
     * @return uint256 The current subsidy in basis points
     */
    function getCurrentSubsidyBps() public view returns (uint256) {
        uint256 currentLeverageBps = getCurrentLeverageBps();

        uint256 subsidyBps;
        if (currentLeverageBps > TARGET_LEVERAGE_BPS) {
            subsidyBps =
                ((currentLeverageBps - TARGET_LEVERAGE_BPS) *
                    BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
                TARGET_LEVERAGE_BPS;
        } else {
            subsidyBps =
                ((TARGET_LEVERAGE_BPS - currentLeverageBps) *
                    BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
                TARGET_LEVERAGE_BPS;
        }
        if (subsidyBps > _defaultMaxSubsidyBps) {
            return _defaultMaxSubsidyBps;
        }
        return subsidyBps;
    }

    /**
     * @dev Gets the address of the underlying asset
     * @return address The address of the underlying asset
     */
    function getUnderlyingAssetAddress() public view returns (address) {
        return this.asset();
    }

    /**
     * @dev Gets the address of the dStable
     * @return address The address of the dStable
     */
    function getDStableAddress() public view returns (address) {
        return address(dStable);
    }

    /**
     * @dev Gets the default maximum subsidy in basis points
     * @return uint256 The default maximum subsidy in basis points
     */
    function getDefaultMaxSubsidyBps() public view returns (uint256) {
        return _defaultMaxSubsidyBps;
    }

    /* Admin */

    /**
     * @dev Sets the maximum subsidy in basis points
     * @param _maxSubsidyBps New maximum subsidy in basis points
     */
    function setMaxSubsidyBps(uint256 _maxSubsidyBps) public onlyOwner nonReentrant {
        _defaultMaxSubsidyBps = _maxSubsidyBps;
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
            _lowerBoundTargetLeverageBps >= TARGET_LEVERAGE_BPS ||
            TARGET_LEVERAGE_BPS >= _upperBoundTargetLeverageBps
        ) {
            revert InvalidLeverageBounds(
                _lowerBoundTargetLeverageBps,
                TARGET_LEVERAGE_BPS,
                _upperBoundTargetLeverageBps
            );
        }

        lowerBoundTargetLeverageBps = _lowerBoundTargetLeverageBps;
        upperBoundTargetLeverageBps = _upperBoundTargetLeverageBps;
    }

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
