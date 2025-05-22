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

import {IPriceOracleGetter} from "./interface/IPriceOracleGetter.sol";
import {IPool as ILendingPool, DataTypes} from "./interface/IPool.sol";
import {IPoolAddressesProvider} from "./interface/IPoolAddressesProvider.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DLoopCoreBase} from "../../DLoopCoreBase.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title DLoopCoreDLend
 * @dev A leveraged vault contract for dLEND
 */
contract DLoopCoreDLend is DLoopCoreBase {
    /* Constants */

    address public constant AAVE_PRICE_ORACLE_BASE_CURRENCY = address(0);
    uint8 public constant AAVE_PRICE_ORACLE_DECIMALS = 8;

    // Note that there is a vulnerability in stable interest rate mode, so we will never use it
    // See contracts/lending/core/protocol/libraries/types/DataTypes.sol
    uint256 public constant VARIABLE_LENDING_INTERST_RATE_MODE = 2; // 0 = NONE, 1 = STABLE, 2 = VARIABLE

    // Maximum percentage factor (100.00%)
    uint256 public constant PERCENTAGE_FACTOR = 1e4;

    /* State */

    IPoolAddressesProvider public immutable lendingPoolAddressesProvider;

    /**
     * @dev Constructor for the DLoopCoreDLend contract
     * @param _name Name of the vault token
     * @param _symbol Symbol of the vault token
     * @param _underlyingAsset Address of the underlying asset
     * @param _dStable Address of the dStable token
     * @param _lendingPoolAddressesProvider Address of the lending pool addresses provider
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
        IPoolAddressesProvider _lendingPoolAddressesProvider,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps
    )
        DLoopCoreBase(
            _name,
            _symbol,
            _underlyingAsset,
            _dStable,
            _targetLeverageBps,
            _lowerBoundTargetLeverageBps,
            _upperBoundTargetLeverageBps,
            _maxSubsidyBps,
            AAVE_PRICE_ORACLE_BASE_CURRENCY,
            AAVE_PRICE_ORACLE_DECIMALS
        )
    {
        lendingPoolAddressesProvider = _lendingPoolAddressesProvider;

        if (
            getLendingOracle().BASE_CURRENCY() != AAVE_PRICE_ORACLE_BASE_CURRENCY
        ) {
            revert("Invalid price oracle base currency");
        }

        uint256 oracleUnit = getLendingOracle().BASE_CURRENCY_UNIT();

        if (oracleUnit != 10 ** AAVE_PRICE_ORACLE_DECIMALS) {
            revert("Invalid price oracle unit");
        }
    }

    /**
     * @dev Gets the asset price from the oracle
     * @param asset Address of the asset
     * @return uint256 Price of the asset
     */
    function getAssetPriceFromOracle(
        address asset
    ) public view override returns (uint256) {
        return getLendingOracle().getAssetPrice(asset);
    }

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
    ) internal override {
        ILendingPool lendingPool = getLendingPool();

        // Approve the lending pool to spend the token
        require(
            ERC20(token).approve(address(lendingPool), amount),
            "approve failed for lending pool in supply"
        );

        // Supply the token to the lending pool
        lendingPool.supply(token, amount, onBehalfOf, 0);
    }

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
    ) internal override {
        getLendingPool().borrow(
            token,
            amount,
            VARIABLE_LENDING_INTERST_RATE_MODE,
            0,
            onBehalfOf
        );
    }

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
    ) internal override {
        ILendingPool lendingPool = getLendingPool();

        // Approve the lending pool to spend the token
        require(
            ERC20(token).approve(address(lendingPool), amount),
            "approve failed for lending pool in repay"
        );

        // Repay the debt
        lendingPool.repay(
            token,
            amount,
            VARIABLE_LENDING_INTERST_RATE_MODE,
            onBehalfOf
        );
    }

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
    ) internal override {
        getLendingPool().withdraw(token, amount, onBehalfOf);
    }

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
        override
        returns (uint256 totalCollateralBase, uint256 totalDebtBase)
    {
        (totalCollateralBase, totalDebtBase, , , , ) = getLendingPool()
            .getUserAccountData(user);
        return (totalCollateralBase, totalDebtBase);
    }

    /**
     * @dev Gets the maximum borrowable amount for a user in base currency
     * @param user Address of the user
     * @param token Address of the token
     * @return uint256 Maximum borrowable amount in token decimals
     */
    function _getMaxBorrowableAmount(
        address user,
        address token
    ) internal view override returns (uint256) {
        uint256 availableBorrowsBase;
        (, , availableBorrowsBase, , , ) = getLendingPool().getUserAccountData(
            user
        );

        uint256 tokenPriceInBase = getAssetPriceFromOracle(token);
        uint256 tokenUnit = 10 ** ERC20(token).decimals();

        // Convert the available borrow amount to the token's decimals
        return (availableBorrowsBase * tokenUnit) / tokenPriceInBase;
    }

    /**
     * @dev Gets the supplied balance of an asset for a user (returns aToken balance for dLEND)
     * @param user Address of the user
     * @param asset Address of the asset
     * @return uint256 Supplied balance of the asset
     */
    function _getSuppliedBalance(
        address user,
        address asset
    ) internal view returns (uint256) {
        address aToken = _getDTokenAddress(asset);
        return ERC20(aToken).balanceOf(user);
    }

    /**
     * @dev Gets the maximum withdrawable amount of a user from the lending pool
     * @param user Address of the user
     * @param token Address of the token to withdraw
     * @return uint256 Maximum withdrawable token amount
     */
    function _getMaxWithdrawableAmount(
        address user,
        address token
    ) internal view override returns (uint256) {
        // This logic is dLEND-specific (aave-v3-specific)

        // Get user account data: totalCollateralBase, totalDebtBase, liquidationThreshold, etc.
        // liquidationThreshold example: 1e4 (100%), 8500 (85%),...
        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            ,
            uint256 currentLiquidationThreshold,
            ,

        ) = getLendingPool().getUserAccountData(user);

        // Calculate max withdrawable in base to keep health factor at 1
        // (totalCollateralBase - X) * liquidationThreshold = totalDebtBase
        // => X = totalCollateralBase - totalDebtBase / liquidationThreshold
        uint256 rightSide = (totalDebtBase * PERCENTAGE_FACTOR) /
            currentLiquidationThreshold;
        uint256 maxWithdrawBase = totalCollateralBase > rightSide
            ? totalCollateralBase - rightSide
            : 0;

        // Convert to asset units
        uint256 maxWithdrawAsset = (maxWithdrawBase *
            (10 ** ERC20(token).decimals())) / getAssetPriceFromOracle(token);

        // Get user's supplied balance of the asset in the lending pool (protocol-specific)
        uint256 supplied = _getSuppliedBalance(user, token);

        // Return the minimum of supplied and calculated max
        return Math.min(maxWithdrawAsset, supplied);
    }

    /* Helper functions */

    /**
     * @dev Gets the lending oracle
     * @return IPriceOracleGetter The lending oracle interface
     */
    function getLendingOracle() public view returns (IPriceOracleGetter) {
        return
            IPriceOracleGetter(lendingPoolAddressesProvider.getPriceOracle());
    }

    /**
     * @dev Gets the lending pool
     * @return ILendingPool The lending pool interface
     */
    function getLendingPool() public view returns (ILendingPool) {
        return ILendingPool(lendingPoolAddressesProvider.getPool());
    }

    /**
     * @dev Gets the lending pool address
     * @return address The lending pool address
     */
    function getLendingPoolAddress() public view returns (address) {
        return address(getLendingPool());
    }

    /**
     * @dev Gets the oracle address
     * @return address The oracle address
     */
    function getOracleAddress() public view returns (address) {
        return address(getLendingOracle());
    }

    /**
     * @dev Gets the reserve data for a token
     * @param tokenAddress The address of the token
     * @return DataTypes.ReserveData The reserve data
     */
    function _getReserveData(
        address tokenAddress
    ) internal view returns (DataTypes.ReserveData memory) {
        return getLendingPool().getReserveData(tokenAddress);
    }

    /**
     * @dev Gets the DToken address for a token
     * @param tokenAddress The address of the token
     * @return address The DToken address
     */
    function _getDTokenAddress(
        address tokenAddress
    ) internal view returns (address) {
        return _getReserveData(tokenAddress).aTokenAddress;
    }

    /**
     * @dev Gets the DToken balance of the vault
     * @param tokenAddress The address of the token
     * @return uint256 The DToken balance of the vault
     */
    function getDTokenBalance(
        address tokenAddress
    ) public view returns (uint256) {
        return ERC20(_getDTokenAddress(tokenAddress)).balanceOf(address(this));
    }
}
