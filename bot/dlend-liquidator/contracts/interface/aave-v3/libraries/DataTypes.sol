// SPDX-License-Identifier: GNU AGPLv3
pragma solidity 0.8.20;

/**
 * @title DataTypes library
 * @author dTRINITY
 * @notice Defines the data structures used in the dlend protocol
 */
library DataTypes {
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
    // Bit 62-63: reserved
    // Bit 64-79: reserve factor
    // Bit 80-115 : borrow cap in whole tokens, borrowCap == 0 => no cap
    // Bit 116-151 : supply cap in whole tokens, supplyCap == 0 => no cap
    // Bit 152-167: liquidation protocol fee
    // Bit 168-175: eMode category
    // Bit 176-211: unbacked mint cap in whole tokens, unbackedMintCap == 0 => minting disabled
    // Bit 212-251: debt ceiling for isolation mode with (ReserveConfiguration::DEBT_CEILING_DECIMALS) decimals
    // Bit 252-255: unused
    uint256 data;
  }
} 