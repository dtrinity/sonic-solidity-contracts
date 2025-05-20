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

/**
 * @title DLoopCoreBase
 * @dev A leveraged vault contract
 */
abstract contract DLoopCoreBase is ERC4626, Ownable {
    using Math for uint256;
    using SafeERC20 for ERC20;

    /* Core state */

    uint32 public lowerBoundTargetLeverageBps;
    uint32 public upperBoundTargetLeverageBps;

    uint32 public immutable TARGET_LEVERAGE_BPS; // ie. 30000 = 300% over 100% in basis points, means 3x leverage
    ERC20 public immutable underlyingAsset;
    ERC20 public immutable dStable;
    uint256 private _defaultMaxSubsidyBps;

    /* Errors */

    error TooImbalanced(
        uint256 currentLeverageBps,
        uint256 lowerBoundTargetLeverageBps,
        uint256 upperBoundTargetLeverageBps
    );
    error InvalidTotalSupplyAndAssets(uint256 totalAssets, uint256 totalSupply);
    error DepositInsufficientToSupply(
        uint256 currentBalance,
        uint256 newTotalAssets
    );
    error UnexpectedLossOfPrincipal(
        uint256 principalBefore,
        uint256 principalAfter
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
    error UnexpectedLossOfWithdrawableAmount(
        uint256 withdrawableAmount,
        uint256 receivedAmount
    );
    error UnexpectedBorrowAmountFromPool(
        uint256 borrowedAmountBefore,
        uint256 borrowedAmountAfter,
        uint256 expectedBorrowedAmount
    );
    error InvalidLeverageBounds(
        uint256 lowerBound,
        uint256 targetLeverage,
        uint256 upperBound
    );

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
     */
    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _underlyingAsset,
        ERC20 _dStable,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps
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

        TARGET_LEVERAGE_BPS = _targetLeverageBps;
        lowerBoundTargetLeverageBps = _lowerBoundTargetLeverageBps;
        upperBoundTargetLeverageBps = _upperBoundTargetLeverageBps;
        _defaultMaxSubsidyBps = _maxSubsidyBps;
    }

    /* Virtual Methods - Required to be implemented by derived contracts */

    /**
     * @dev Gets the asset price from the oracle
     * @param asset Address of the asset
     * @return uint256 Price of the asset
     */
    function getAssetPriceFromOracle(
        address asset
    ) public view virtual returns (uint256);

    /**
     * @dev Supply tokens to the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to supply
     * @param onBehalfOf Address to supply on behalf of
     */
    function _supplyToPool(
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
    function _borrowFromPool(
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
    function _repayDebt(
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
    function _withdrawFromPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal virtual;

    /**
     * @dev Gets the base asset address and symbol
     * @return address Base asset address
     * @return string Base asset symbol
     */
    function _getBaseAssetAddressAndSymbol()
        internal
        view
        virtual
        returns (address, string memory);

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

    /* Helper Functions */

    /**
     * @dev Gets the maximum withdrawable amount of an asset
     * @param user Address of the user
     * @param asset Address of the asset
     * @return uint256 Maximum withdrawable amount of the asset
     */
    function _getMaxWithdrawAmount(
        address user,
        address asset
    ) internal view returns (uint256) {
        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase
        ) = _getTotalCollateralAndDebtOfUserInBase(user);

        uint256 assetPriceInBase = getAssetPriceFromOracle(asset);
        uint256 maxWithdrawInBase = totalCollateralBase - totalDebtBase;

        uint256 assetTokenUnit = 10 ** ERC20(asset).decimals();
        return (maxWithdrawInBase * assetTokenUnit) / assetPriceInBase;
    }

    /**
     * @dev Override of totalAssets from ERC4626
     * @return uint256 Total assets in the vault
     */
    function totalAssets() public view virtual override returns (uint256) {
        // We override this function to return the total assets in the vault
        // with respect to the position in the lending pool
        // The dLend interest will be distributed to the dToken
        return _getMaxWithdrawAmount(address(this), address(underlyingAsset));
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
     * @dev Rescues tokens accidentally sent to the contract
     * @param token Address of the token to rescue
     * @param receiver Address to receive the rescued tokens
     */
    function rescueToken(address token, address receiver) public onlyOwner {
        ERC20(token).safeTransfer(
            receiver,
            ERC20(token).balanceOf(address(this))
        );
    }

    /**
     * @dev Calculates the leveraged amount of the assets
     * @param assets Amount of assets
     * @return leveragedAssets Amount of leveraged assets
     */
    function getLeveragedAssets(uint256 assets) public view returns (uint256) {
        return
            (assets * TARGET_LEVERAGE_BPS) / BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
    }

    /* Deposit and Mint */

    /**
     * @dev Deposits assets into the vault (it actually requires to spent the leveraged amount of the assets, ie. if assets=1, and leverage=2, it means 2 assets are required to be spent)
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
    ) internal override {
        // Make sure the current leverage is within the target range
        if (isTooImbalanced()) {
            revert TooImbalanced(
                getCurrentLeverageBps(),
                lowerBoundTargetLeverageBps,
                upperBoundTargetLeverageBps
            );
        }

        // Calculate the leveraged amount of the assets to be deposited to the pool
        uint256 leveragedAssets = getLeveragedAssets(assets);

        // Transfer the assets to the vault (need the allowance before calling this function)
        underlyingAsset.safeTransferFrom(
            caller,
            address(this),
            leveragedAssets
        );

        _depositToPoolImplementation(leveragedAssets, receiver);

        // Mint the vault's shares to the depositor
        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    function _depositToPoolImplementation(
        uint256 newTotalAssets, // deposit amount
        address receiver
    ) private {
        // At this step, we assume that the funds from the depositor are already in the vault

        // Make sure we have enough balance to supply before supplying
        uint256 currentUnderlyingAssetBalance = underlyingAsset.balanceOf(
            address(this)
        );
        if (currentUnderlyingAssetBalance < newTotalAssets) {
            revert DepositInsufficientToSupply(
                currentUnderlyingAssetBalance,
                newTotalAssets
            );
        }

        uint256 maxDStableToBorrowBeforeSupply = _getMaxWithdrawAmount(
            address(this),
            address(dStable)
        );

        // Supply the underlying asset to the lending pool
        _supplyToPool(address(underlyingAsset), newTotalAssets, address(this));

        uint256 maxDStableToBorrowAfterSupply = _getMaxWithdrawAmount(
            address(this),
            address(dStable)
        );

        if (maxDStableToBorrowAfterSupply <= maxDStableToBorrowBeforeSupply) {
            revert MaxDStableToBorrowNotIncreasedAfterSupply(
                maxDStableToBorrowBeforeSupply,
                maxDStableToBorrowAfterSupply
            );
        }

        // Now, this value > 0
        uint256 maxDStableToBorrow = maxDStableToBorrowAfterSupply -
            maxDStableToBorrowBeforeSupply;

        uint256 dStableBalanceBeforeBorrow = dStable.balanceOf(address(this));

        // Borrow the max amount of dStable
        _borrowFromPool(address(dStable), maxDStableToBorrow, address(this));

        uint256 dStableBalanceAfterBorrow = dStable.balanceOf(address(this));

        if (
            dStableBalanceAfterBorrow - dStableBalanceBeforeBorrow <
            maxDStableToBorrow
        ) {
            revert UnexpectedBorrowAmountFromPool(
                dStableBalanceBeforeBorrow,
                dStableBalanceAfterBorrow,
                maxDStableToBorrow
            );
        }

        // Transfer the dStable to the receiver
        dStable.safeTransfer(receiver, maxDStableToBorrow);
    }

    /* Withdraw and Redeem */

    /**
     * @dev Withdraws assets from the vault (it actually requires to spent the leveraged amount of the assets, ie. if assets=1, and leverage=2, it means 2 assets are required to be spent)
     * @param caller Address of the caller
     * @param receiver Address to receive the withdrawn assets
     * @param owner Address of the owner
     * @param principalAssetsToRemove Amount of assets to remove from the lending pool
     * @param shares Amount of shares to burn
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 principalAssetsToRemove,
        uint256 shares
    ) internal override {
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

        uint256 receivedUnderlyingAmount = _withdrawFromPoolImplementation(principalAssetsToRemove, receiver);

        emit Withdraw(
            caller,
            receiver,
            owner,
            receivedUnderlyingAmount,
            shares
        );
    }

    /**
     * @dev Handles the logic for repaying debt and withdrawing collateral from the pool, then transfers to receiver
     * @param principalAssetsToRemove Amount of assets to remove from the lending pool (principal, not leveraged)
     * @param receiver Address to receive the withdrawn assets
     * @return receivedUnderlyingAmount The actual amount of underlying asset received and transferred to receiver
     */
    function _withdrawFromPoolImplementation(
        uint256 principalAssetsToRemove,
        address receiver
    ) private returns (uint256 receivedUnderlyingAmount) {
        uint256 assetsToRemoveFromLending = (principalAssetsToRemove * TARGET_LEVERAGE_BPS) / BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        uint256 underlyingAssetBalanceBefore = underlyingAsset.balanceOf(address(this));
        uint256 maxWithdrawUnderlyingBeforeRepay = _getMaxWithdrawAmount(address(this), address(underlyingAsset));

        // Calculate dStable to repay
        uint256 dStableToRepay = ((assetsToRemoveFromLending * (getAssetPriceFromOracle(address(underlyingAsset)) * 10 ** dStable.decimals())) /
            (getAssetPriceFromOracle(address(dStable)) * 10 ** underlyingAsset.decimals()));
        uint256 currentLeverageBps = getCurrentLeverageBps();

        // Repay the debt to withdraw the collateral
        _repayDebt(address(dStable), dStableToRepay, address(this));

        uint256 maxWithdrawUnderlyingAfterRepay = _getMaxWithdrawAmount(address(this), address(underlyingAsset));

        // Make sure the max withdraw amount of underlying asset is not decreased after repaying the debt
        if (maxWithdrawUnderlyingAfterRepay < maxWithdrawUnderlyingBeforeRepay) {
            revert InvalidMaxWithdrawAfterRepay(
                address(underlyingAsset),
                maxWithdrawUnderlyingBeforeRepay,
                maxWithdrawUnderlyingAfterRepay
            );
        }

        uint256 withdrawableUnderlyingAmount = _getWithdrawAmountThatKeepCurrentLeverage(
            maxWithdrawUnderlyingBeforeRepay,
            maxWithdrawUnderlyingAfterRepay,
            currentLeverageBps
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

        uint256 underlyingAssetBalanceAfter = underlyingAsset.balanceOf(address(this));

        if (underlyingAssetBalanceAfter < underlyingAssetBalanceBefore) {
            revert UnexpectedLossOfPrincipal(
                underlyingAssetBalanceBefore,
                underlyingAssetBalanceAfter
            );
        }

        receivedUnderlyingAmount = underlyingAssetBalanceAfter - underlyingAssetBalanceBefore;

        if (receivedUnderlyingAmount < withdrawableUnderlyingAmount) {
            revert UnexpectedLossOfWithdrawableAmount(
                withdrawableUnderlyingAmount,
                receivedUnderlyingAmount
            );
        }

        // Transfer the remaining assets to the receiver
        underlyingAsset.safeTransfer(receiver, receivedUnderlyingAmount);
    }

    /**
     * @dev Gets the withdrawable amount that keeps the current leverage
     * @param maxWithdrawAmountBeforeRepay Maximum withdrawable amount before repaying
     * @param maxWithdrawAmountAfterRepay Maximum withdrawable amount after repaying
     * @param currentLeverageBps Current leverage in basis points
     * @return uint256 Withdrawable amount that keeps the current leverage
     */
    function _getWithdrawAmountThatKeepCurrentLeverage(
        uint256 maxWithdrawAmountBeforeRepay,
        uint256 maxWithdrawAmountAfterRepay,
        uint256 currentLeverageBps
    ) internal pure returns (uint256) {
        // Assume the maxWithdrawAmountBeforeRepay and maxWithdrawAmountAfterRepay are in the same unit
        //
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
        uint256 difference = maxWithdrawAmountAfterRepay -
            maxWithdrawAmountBeforeRepay;

        // Instead of using TARGET_LEVERAGE_BPS, we use the current leverage to calculate the withdrawable amount to avoid
        // unexpectedly changing the current leverage (which may cause loss to the user)
        if (currentLeverageBps <= BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            // If there is no more debt, withdraw as much as possible
            return type(uint256).max;
        }

        return
            (difference * currentLeverageBps) /
            (currentLeverageBps - BasisPointConstants.ONE_HUNDRED_PERCENT_BPS);
    }

    /* Rebalance */

    function increaseLeverage(
        uint256 assetAmount,
        uint256 minPriceInBase
    ) public {
        uint256 assetPriceInBase = getAssetPriceFromOracle(
            address(underlyingAsset)
        );
        if (assetPriceInBase < minPriceInBase) {
            revert BelowMinPrice(assetPriceInBase, minPriceInBase);
        }

        uint256 assetAmountInBase = (assetAmount * assetPriceInBase) /
            (10 ** underlyingAsset.decimals());

        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase
        ) = _getTotalCollateralAndDebtOfUserInBase(address(this));

        uint256 currentSubsidyBps = _getCurrentSubsidyBps();

        uint256 dStablePriceInBase = getAssetPriceFromOracle(address(dStable));
        uint256 borrowedDStableInBase = (assetAmountInBase *
            (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS + currentSubsidyBps)) /
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
        uint256 borrowedDStable = (borrowedDStableInBase *
            (10 ** dStable.decimals())) / dStablePriceInBase;
        _borrowFromPool(address(dStable), borrowedDStable, address(this));

        // Transfer the dStable to the user
        dStable.safeTransfer(msg.sender, borrowedDStable);
    }

    function decreaseLeverage(
        uint256 dStableAmount,
        uint256 maxPriceInBase
    ) public {
        uint256 assetPriceInBase = getAssetPriceFromOracle(
            address(underlyingAsset)
        );
        if (assetPriceInBase > maxPriceInBase) {
            revert ExceedMaxPrice(assetPriceInBase, maxPriceInBase);
        }

        uint256 dStableAmountInBase = (dStableAmount *
            getAssetPriceFromOracle(address(dStable))) /
            (10 ** dStable.decimals());

        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase
        ) = _getTotalCollateralAndDebtOfUserInBase(address(this));

        uint256 currentSubsidyBps = _getCurrentSubsidyBps();
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

        _repayDebt(address(dStable), dStableAmount, address(this));

        // Withdraw collateral
        uint256 withdrawnAssets = (withdrawnAssetsBase *
            (10 ** underlyingAsset.decimals())) / assetPriceInBase;

        uint256 underlyingAssetBalanceBefore = underlyingAsset.balanceOf(
            address(this)
        );

        _withdrawFromPool(
            address(underlyingAsset),
            withdrawnAssets,
            address(this)
        );

        uint256 underlyingAssetBalanceAfter = underlyingAsset.balanceOf(
            address(this)
        );

        if (underlyingAssetBalanceAfter < underlyingAssetBalanceBefore) {
            revert UnexpectedLossOfPrincipal(
                underlyingAssetBalanceBefore,
                underlyingAssetBalanceAfter
            );
        }

        uint256 receivedUnderlyingAmount = underlyingAssetBalanceAfter -
            underlyingAssetBalanceBefore;

        if (receivedUnderlyingAmount < withdrawnAssets) {
            revert UnexpectedLossOfWithdrawableAmount(
                withdrawnAssets,
                receivedUnderlyingAmount
            );
        }

        // Transfer the withdrawn assets to the user
        underlyingAsset.safeTransfer(msg.sender, withdrawnAssets);
    }

    function _getCurrentSubsidyBps() internal view returns (uint256) {
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
        return ((totalCollateralBase * BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
            (totalCollateralBase - totalDebtBase));
    }

    function getUnderlyingAssetAddress() public view returns (address) {
        return this.asset();
    }

    function getDStableAddress() public view returns (address) {
        return address(dStable);
    }

    function getDefaultMaxSubsidyBps() public view returns (uint256) {
        return _defaultMaxSubsidyBps;
    }

    /* Admin */

    /**
     * @dev Sets the maximum subsidy in basis points
     * @param _maxSubsidyBps New maximum subsidy in basis points
     */
    function setMaxSubsidyBps(uint256 _maxSubsidyBps) public onlyOwner {
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
    ) public onlyOwner {
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
