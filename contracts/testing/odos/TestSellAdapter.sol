// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseOdosSellAdapterV2 } from "contracts/dlend/periphery/adapters/odos/BaseOdosSellAdapterV2.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";

contract TestSellAdapter is BaseOdosSellAdapterV2 {
    constructor(
        IOdosRouterV2 router,
        address pendleRouter
    ) BaseOdosSellAdapterV2(IPoolAddressesProvider(address(0)), address(0), router, pendleRouter) {}

    // Stubs for abstract methods
    function _getReserveData(address) internal pure override returns (address, address, address) {
        return (address(0), address(0), address(0));
    }

    function _supply(address, uint256, address, uint16) internal pure override {}

    // Override oracle validation for testing (skip it)
    function _validateOraclePriceExactInput(address, address, uint256, uint256) internal pure override {}

    // Public helper
    function sell(
        IERC20Detailed assetFrom,
        IERC20Detailed assetTo,
        uint256 amountToSwap,
        uint256 minAmountToReceive,
        bytes calldata swapData
    ) external returns (uint256) {
        return _executeAdaptiveSwap(assetFrom, assetTo, amountToSwap, minAmountToReceive, swapData);
    }
}
