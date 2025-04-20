// SPDX-License-Identifier: GNU AGPLv3
pragma solidity 0.8.20;

/**
 * @title DataTypes library
 * @author dTRINITY
 * @notice Defines the data structures used in the dlend protocol
 */
library DataTypes {
  struct ReserveData {
    //stores the reserve configuration
    ReserveConfigurationMap configuration;
    //the liquidity index. Expressed in ray
    uint128 liquidityIndex;
    //the current supply rate. Expressed in ray
    uint128 currentLiquidityRate;
    //variable borrow index. Expressed in ray
    uint128 variableBorrowIndex;
    //the current variable borrow rate. Expressed in ray
    uint128 currentVariableBorrowRate;
    //the current stable borrow rate. Expressed in ray
    uint128 currentStableBorrowRate;
    //timestamp of last update
    uint40 lastUpdateTimestamp;
    //the id of the reserve. Represents the position in the list of the active reserves
    uint16 id;
    //aToken address
    address aTokenAddress;
    //stableDebtToken address
    address stableDebtTokenAddress;
    //variableDebtToken address
    address variableDebtTokenAddress;
    //address of the interest rate strategy
    address interestRateStrategyAddress;
    //the current treasury balance, scaled
    uint128 accruedToTreasury;
    //the outstanding unbacked aTokens minted through the bridging feature
    uint128 unbacked;
    //the outstanding debt borrowed against this asset in isolation mode
    uint128 isolationModeTotalDebt;
  }

  struct ReserveConfigurationMap {
    // Bit 0-15: LTV
    // Bit 16-31: Liq. threshold
    // Bit 32-47: Liq. bonus
    // Bit 48-55: Decimals
    // Bit 56: reserve is active
    // Bit 57: reserve is frozen
    // Bit 58: borrowing is enabled
    // Bit 59: stable rate borrowing enabled
    // Bit 60: asset is paused
    // Bit 61: borrowing in isolation mode is enabled
    // Bit 62: siloed borrowing enabled
    // Bit 63: flashloaning enabled
    // Bit 64-79: reserve factor
    // Bit 80-115: borrow cap in whole tokens, borrowCap == 0 => no cap
    // Bit 116-151: supply cap in whole tokens, supplyCap == 0 => no cap
    // Bit 152-167: liquidation protocol fee
    // Bit 168-175: eMode category
    // Bit 176-211: unbacked mint cap in whole tokens, unbackedMintCap == 0 => minting disabled
    // Bit 212-251: debt ceiling for isolation mode with (ReserveConfiguration::DEBT_CEILING_DECIMALS) decimals
    // Bit 252-255: unused
    uint256 data;
  }

  struct UserConfigurationMap {
    /**
     * @dev Bitmap of the users collaterals and borrows. It is divided in pairs of bits, one pair per asset.
     * The first bit indicates if an asset is used as collateral by the user, the second whether an
     * asset is borrowed by the user.
     */
    uint256 data;
  }

  enum InterestRateMode {
    NONE,
    STABLE,
    VARIABLE
  }

  struct EModeCategory {
    // each eMode category has a custom ltv and liquidation threshold
    uint16 ltv;
    uint16 liquidationThreshold;
    uint16 liquidationBonus;
    // each eMode category may or may not have a custom oracle to override the individual assets price oracles
    address priceSource;
    string label;
  }
} 