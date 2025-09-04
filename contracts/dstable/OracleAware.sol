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

import "@openzeppelin/contracts/access/AccessControl.sol";
import "contracts/common/IAaveOracle.sol";

/**
 * @title OracleAware
 * @notice Abstract contract that provides oracle functionality to other contracts
 */
abstract contract OracleAware is AccessControl {
    /* Core state */

    IPriceOracleGetter public oracle;
    uint256 public baseCurrencyUnit;

    /* Events */

    event OracleSet(address indexed newOracle);

    /* Errors */

    error IncorrectBaseCurrencyUnit(uint256 baseCurrencyUnit);

    /**
     * @notice Initializes the contract with an oracle and base currency unit
     * @param initialOracle The initial oracle to use for price feeds
     * @param _baseCurrencyUnit The base currency unit for price calculations
     * @dev Sets up the initial oracle and base currency unit values
     */
    constructor(IPriceOracleGetter initialOracle, uint256 _baseCurrencyUnit) {
        oracle = initialOracle;
        baseCurrencyUnit = _baseCurrencyUnit;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Sets the oracle to use for collateral valuation
     * @param newOracle The new oracle to use
     */
    function setOracle(IPriceOracleGetter newOracle) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newOracle.BASE_CURRENCY_UNIT() != baseCurrencyUnit) {
            revert IncorrectBaseCurrencyUnit(baseCurrencyUnit);
        }

        oracle = newOracle;

        emit OracleSet(address(newOracle));
    }

    /**
     * @notice Updates the base currency unit used for price calculations
     * @param _newBaseCurrencyUnit The new base currency unit to set
     * @dev Only used if the oracle's base currency unit changes
     */
    function setBaseCurrencyUnit(uint256 _newBaseCurrencyUnit) public onlyRole(DEFAULT_ADMIN_ROLE) {
        baseCurrencyUnit = _newBaseCurrencyUnit;
    }
}
