// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/vaults/dloop/core/venue/dlend/interface/types/DataTypes.sol";

contract MockPool {
    mapping(address => DataTypes.ReserveData) private _reserves;

    function setReserveData(
        address asset,
        address aToken,
        address stableDebtToken,
        address variableDebtToken
    ) external {
        DataTypes.ReserveData memory d;
        d.aTokenAddress = aToken;
        d.stableDebtTokenAddress = stableDebtToken;
        d.variableDebtTokenAddress = variableDebtToken;
        _reserves[asset] = d;
    }

    function getReserveData(address asset) external view returns (DataTypes.ReserveData memory) {
        return _reserves[asset];
    }
}
