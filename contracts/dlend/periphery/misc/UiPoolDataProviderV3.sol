// SPDX-License-Identifier: AGPL-3.0
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

import {IERC20Detailed} from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import {IPoolAddressesProvider} from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import {IPool} from "contracts/dlend/core/interfaces/IPool.sol";
import {IAaveOracle} from "contracts/dlend/core/interfaces/IAaveOracle.sol";
import {IAToken} from "contracts/dlend/core/interfaces/IAToken.sol";
import {IVariableDebtToken} from "contracts/dlend/core/interfaces/IVariableDebtToken.sol";
import {IStableDebtToken} from "contracts/dlend/core/interfaces/IStableDebtToken.sol";
import {DefaultReserveInterestRateStrategy} from "contracts/dlend/core/protocol/pool/DefaultReserveInterestRateStrategy.sol";
import {AaveProtocolDataProvider} from "contracts/dlend/core/misc/AaveProtocolDataProvider.sol";
import {WadRayMath} from "contracts/dlend/core/protocol/libraries/math/WadRayMath.sol";
import {ReserveConfiguration} from "contracts/dlend/core/protocol/libraries/configuration/ReserveConfiguration.sol";
import {UserConfiguration} from "contracts/dlend/core/protocol/libraries/configuration/UserConfiguration.sol";
import {DataTypes} from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";
import {IERC20DetailedBytes} from "./interfaces/IERC20DetailedBytes.sol";
import {IUiPoolDataProviderV3} from "./interfaces/IUiPoolDataProviderV3.sol";

contract UiPoolDataProviderV3 is IUiPoolDataProviderV3 {
    using WadRayMath for uint256;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;
    using UserConfiguration for DataTypes.UserConfigurationMap;

    IAaveOracle public immutable priceOracle;
    address public immutable wethAddress;
    uint256 public constant ETH_CURRENCY_UNIT = 1 ether;

    constructor(IAaveOracle _priceOracle, address _wethAddress) {
        priceOracle = _priceOracle;
        wethAddress = _wethAddress;
    }

    function getReservesList(
        IPoolAddressesProvider provider
    ) public view override returns (address[] memory) {
        IPool pool = IPool(provider.getPool());
        return pool.getReservesList();
    }

    function getReservesData(
        IPoolAddressesProvider provider
    )
        public
        view
        override
        returns (AggregatedReserveData[] memory, BaseCurrencyInfo memory)
    {
        IAaveOracle oracle = IAaveOracle(provider.getPriceOracle());
        IPool pool = IPool(provider.getPool());
        AaveProtocolDataProvider poolDataProvider = AaveProtocolDataProvider(
            provider.getPoolDataProvider()
        );

        address[] memory reserves = pool.getReservesList();
        AggregatedReserveData[]
            memory reservesData = new AggregatedReserveData[](reserves.length);

        for (uint256 i = 0; i < reserves.length; i++) {
            AggregatedReserveData memory reserveData = reservesData[i];
            reserveData.underlyingAsset = reserves[i];

            // reserve current state
            DataTypes.ReserveData memory baseData = pool.getReserveData(
                reserveData.underlyingAsset
            );
            //the liquidity index. Expressed in ray
            reserveData.liquidityIndex = baseData.liquidityIndex;
            //variable borrow index. Expressed in ray
            reserveData.variableBorrowIndex = baseData.variableBorrowIndex;
            //the current supply rate. Expressed in ray
            reserveData.liquidityRate = baseData.currentLiquidityRate;
            //the current variable borrow rate. Expressed in ray
            reserveData.variableBorrowRate = baseData.currentVariableBorrowRate;
            //the current stable borrow rate. Expressed in ray
            reserveData.stableBorrowRate = baseData.currentStableBorrowRate;
            reserveData.lastUpdateTimestamp = baseData.lastUpdateTimestamp;
            reserveData.aTokenAddress = baseData.aTokenAddress;
            reserveData.stableDebtTokenAddress = baseData
                .stableDebtTokenAddress;
            reserveData.variableDebtTokenAddress = baseData
                .variableDebtTokenAddress;
            //address of the interest rate strategy
            reserveData.interestRateStrategyAddress = baseData
                .interestRateStrategyAddress;

            reserveData.priceInMarketReferenceCurrency = oracle.getAssetPrice(
                reserveData.underlyingAsset
            );
            reserveData.priceOracle = oracle.getSourceOfAsset(
                reserveData.underlyingAsset
            );
            reserveData.availableLiquidity = IERC20Detailed(
                reserveData.underlyingAsset
            ).balanceOf(reserveData.aTokenAddress);
            (
                reserveData.totalPrincipalStableDebt,
                ,
                reserveData.averageStableRate,
                reserveData.stableDebtLastUpdateTimestamp
            ) = IStableDebtToken(reserveData.stableDebtTokenAddress)
                .getSupplyData();
            reserveData.totalScaledVariableDebt = IVariableDebtToken(
                reserveData.variableDebtTokenAddress
            ).scaledTotalSupply();

            reserveData.symbol = IERC20Detailed(reserveData.underlyingAsset)
                .symbol();
            reserveData.name = IERC20Detailed(reserveData.underlyingAsset)
                .name();

            //stores the reserve configuration
            DataTypes.ReserveConfigurationMap
                memory reserveConfigurationMap = baseData.configuration;
            uint256 eModeCategoryId;
            (
                reserveData.baseLTVasCollateral,
                reserveData.reserveLiquidationThreshold,
                reserveData.reserveLiquidationBonus,
                reserveData.decimals,
                reserveData.reserveFactor,
                eModeCategoryId
            ) = reserveConfigurationMap.getParams();
            reserveData.usageAsCollateralEnabled =
                reserveData.baseLTVasCollateral != 0;

            (
                reserveData.isActive,
                reserveData.isFrozen,
                reserveData.borrowingEnabled,
                reserveData.stableBorrowRateEnabled,
                reserveData.isPaused
            ) = reserveConfigurationMap.getFlags();

            // interest rates
            try
                DefaultReserveInterestRateStrategy(
                    reserveData.interestRateStrategyAddress
                ).getVariableRateSlope1()
            returns (uint256 res) {
                reserveData.variableRateSlope1 = res;
            } catch {}
            try
                DefaultReserveInterestRateStrategy(
                    reserveData.interestRateStrategyAddress
                ).getVariableRateSlope2()
            returns (uint256 res) {
                reserveData.variableRateSlope2 = res;
            } catch {}
            try
                DefaultReserveInterestRateStrategy(
                    reserveData.interestRateStrategyAddress
                ).getStableRateSlope1()
            returns (uint256 res) {
                reserveData.stableRateSlope1 = res;
            } catch {}
            try
                DefaultReserveInterestRateStrategy(
                    reserveData.interestRateStrategyAddress
                ).getStableRateSlope2()
            returns (uint256 res) {
                reserveData.stableRateSlope2 = res;
            } catch {}
            try
                DefaultReserveInterestRateStrategy(
                    reserveData.interestRateStrategyAddress
                ).getBaseStableBorrowRate()
            returns (uint256 res) {
                reserveData.baseStableBorrowRate = res;
            } catch {}
            try
                DefaultReserveInterestRateStrategy(
                    reserveData.interestRateStrategyAddress
                ).getBaseVariableBorrowRate()
            returns (uint256 res) {
                reserveData.baseVariableBorrowRate = res;
            } catch {}
            try
                DefaultReserveInterestRateStrategy(
                    reserveData.interestRateStrategyAddress
                ).OPTIMAL_USAGE_RATIO()
            returns (uint256 res) {
                reserveData.optimalUsageRatio = res;
            } catch {}

            // v3 only
            reserveData.eModeCategoryId = uint8(eModeCategoryId);
            reserveData.debtCeiling = reserveConfigurationMap.getDebtCeiling();
            reserveData.debtCeilingDecimals = poolDataProvider
                .getDebtCeilingDecimals();
            (
                reserveData.borrowCap,
                reserveData.supplyCap
            ) = reserveConfigurationMap.getCaps();

            try
                poolDataProvider.getFlashLoanEnabled(
                    reserveData.underlyingAsset
                )
            returns (bool flashLoanEnabled) {
                reserveData.flashLoanEnabled = flashLoanEnabled;
            } catch (bytes memory) {
                reserveData.flashLoanEnabled = true;
            }

            reserveData.isSiloedBorrowing = reserveConfigurationMap
                .getSiloedBorrowing();
            reserveData.unbacked = baseData.unbacked;
            reserveData.isolationModeTotalDebt = baseData
                .isolationModeTotalDebt;
            reserveData.accruedToTreasury = baseData.accruedToTreasury;

            DataTypes.EModeCategory memory categoryData = pool
                .getEModeCategoryData(reserveData.eModeCategoryId);
            reserveData.eModeLtv = categoryData.ltv;
            reserveData.eModeLiquidationThreshold = categoryData
                .liquidationThreshold;
            reserveData.eModeLiquidationBonus = categoryData.liquidationBonus;
            // each eMode category may or may not have a custom oracle to override the individual assets price oracles
            reserveData.eModePriceSource = categoryData.priceSource;
            reserveData.eModeLabel = categoryData.label;

            reserveData.borrowableInIsolation = reserveConfigurationMap
                .getBorrowableInIsolation();
        }

        BaseCurrencyInfo memory baseCurrencyInfo;

        // Get networkBaseToken (the gas token) price in USD
        baseCurrencyInfo.networkBaseTokenPriceInUsd = int256(
            priceOracle.getAssetPrice(wethAddress)
        );

        // Set decimals (The Aave ecosystem uses 8 decimals for the base currency)
        baseCurrencyInfo.networkBaseTokenPriceDecimals = 8;

        try oracle.BASE_CURRENCY_UNIT() returns (uint256 baseCurrencyUnit) {
            baseCurrencyInfo.marketReferenceCurrencyUnit = baseCurrencyUnit;
            baseCurrencyInfo.marketReferenceCurrencyPriceInUsd = int256(
                baseCurrencyUnit
            );
        } catch {
            baseCurrencyInfo.marketReferenceCurrencyUnit = ETH_CURRENCY_UNIT;

            // Get marketReferenceCurrency price in USD (same as networkBaseToken price since they're the same)
            baseCurrencyInfo.marketReferenceCurrencyPriceInUsd = int256(
                priceOracle.getAssetPrice(wethAddress)
            );
        }

        return (reservesData, baseCurrencyInfo);
    }

    function getUserReservesData(
        IPoolAddressesProvider provider,
        address user
    ) external view override returns (UserReserveData[] memory, uint8) {
        IPool pool = IPool(provider.getPool());
        address[] memory reserves = pool.getReservesList();
        DataTypes.UserConfigurationMap memory userConfig = pool
            .getUserConfiguration(user);

        uint8 userEmodeCategoryId = uint8(pool.getUserEMode(user));

        UserReserveData[] memory userReservesData = new UserReserveData[](
            user != address(0) ? reserves.length : 0
        );

        for (uint256 i = 0; i < reserves.length; i++) {
            DataTypes.ReserveData memory baseData = pool.getReserveData(
                reserves[i]
            );

            // user reserve data
            userReservesData[i].underlyingAsset = reserves[i];
            userReservesData[i].scaledATokenBalance = IAToken(
                baseData.aTokenAddress
            ).scaledBalanceOf(user);
            userReservesData[i].usageAsCollateralEnabledOnUser = userConfig
                .isUsingAsCollateral(i);

            if (userConfig.isBorrowing(i)) {
                userReservesData[i].scaledVariableDebt = IVariableDebtToken(
                    baseData.variableDebtTokenAddress
                ).scaledBalanceOf(user);
                userReservesData[i].principalStableDebt = IStableDebtToken(
                    baseData.stableDebtTokenAddress
                ).principalBalanceOf(user);
                if (userReservesData[i].principalStableDebt != 0) {
                    userReservesData[i].stableBorrowRate = IStableDebtToken(
                        baseData.stableDebtTokenAddress
                    ).getUserStableRate(user);
                    userReservesData[i]
                        .stableBorrowLastUpdateTimestamp = IStableDebtToken(
                        baseData.stableDebtTokenAddress
                    ).getUserLastUpdated(user);
                }
            }
        }

        return (userReservesData, userEmodeCategoryId);
    }

    function bytes32ToString(
        bytes32 _bytes32
    ) public pure returns (string memory) {
        uint8 i = 0;
        while (i < 32 && _bytes32[i] != 0) {
            i++;
        }
        bytes memory bytesArray = new bytes(i);
        for (i = 0; i < 32 && _bytes32[i] != 0; i++) {
            bytesArray[i] = _bytes32[i];
        }
        return string(bytesArray);
    }
}
