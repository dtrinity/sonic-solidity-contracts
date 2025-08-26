// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseOdosBuyAdapter } from "contracts/dlend/periphery/adapters/odos/BaseOdosBuyAdapter.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";

/// @dev Dummy implementation of BaseOdosBuyAdapter exposing internal function for tests.
contract TestBuyAdapter is BaseOdosBuyAdapter {
    constructor(IOdosRouterV2 router) BaseOdosBuyAdapter(IPoolAddressesProvider(address(0)), address(0), router) {}

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

    // ----------------- Test helper -------------------
    function buy(
        IERC20Detailed assetFrom,
        IERC20Detailed assetTo,
        uint256 maxAmountToSwap,
        uint256 amountToReceive,
        bytes calldata swapData
    ) external returns (uint256) {
        return _buyOnOdos(assetFrom, assetTo, maxAmountToSwap, amountToReceive, swapData);
    }
}
