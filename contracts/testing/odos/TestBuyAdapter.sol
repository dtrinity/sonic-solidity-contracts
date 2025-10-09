// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseOdosBuyAdapterV2 } from "contracts/dlend/periphery/adapters/odos/BaseOdosBuyAdapterV2.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";

/// @dev Dummy implementation of BaseOdosBuyAdapterV2 exposing internal function for tests.
contract TestBuyAdapter is BaseOdosBuyAdapterV2 {
    constructor(
        IOdosRouterV2 router,
        address pendleRouter
    ) BaseOdosBuyAdapterV2(IPoolAddressesProvider(address(0)), address(0), router, pendleRouter) {}

    // ----------------- Required abstract stubs -------------------
    function _getReserveData(address /*asset*/) internal pure override returns (address, address, address) {
        return (address(0), address(0), address(0));
    }

    function _supply(
        address /*asset*/,
        uint256 /*amount*/,
        address /*to*/,
        uint16 /*referralCode*/
    ) internal pure override {}

    // Override oracle validation for testing (skip it)
    function _validateOraclePriceExactOutput(address, address, uint256, uint256) internal pure override {}

    // ----------------- Test helper -------------------
    function buy(
        IERC20Detailed assetFrom,
        IERC20Detailed assetTo,
        uint256 maxAmountToSwap,
        uint256 amountToReceive,
        bytes calldata swapData
    ) external returns (uint256) {
        return _executeAdaptiveBuy(assetFrom, assetTo, maxAmountToSwap, amountToReceive, swapData);
    }
}
