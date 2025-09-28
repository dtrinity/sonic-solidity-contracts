// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { DataTypes } from "contracts/vaults/dloop/core/venue/dlend/interface/types/DataTypes.sol";
import { IAaveFlashLoanReceiver } from "contracts/dlend/periphery/adapters/curve/interfaces/IAaveFlashLoanReceiver.sol";
import { MockAToken } from "./MockAToken.sol";

contract StatefulMockPool {
    using SafeERC20 for IERC20;

    mapping(address => DataTypes.ReserveData) private _reserves;
    address[] private _reservesList;

    error UnknownReserve(address asset);
    error FlashLoanCallbackFailed();
    error UnsupportedMultiAssetFlashLoan();

    function setReserveData(
        address asset,
        address aToken,
        address stableDebtToken,
        address variableDebtToken
    ) external {
        DataTypes.ReserveData storage data = _reserves[asset];
        data.aTokenAddress = aToken;
        data.stableDebtTokenAddress = stableDebtToken;
        data.variableDebtTokenAddress = variableDebtToken;

        bool exists;
        for (uint256 i = 0; i < _reservesList.length; ++i) {
            if (_reservesList[i] == asset) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            _reservesList.push(asset);
        }
    }

    function getReserveData(address asset) external view returns (DataTypes.ReserveData memory) {
        return _reserves[asset];
    }

    function getReservesList() external view returns (address[] memory) {
        return _reservesList;
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external {
        referralCode;
        address aToken = _reserves[asset].aTokenAddress;
        if (aToken == address(0)) {
            revert UnknownReserve(asset);
        }

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        MockAToken(aToken).mint(onBehalfOf, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        address aToken = _reserves[asset].aTokenAddress;
        if (aToken == address(0)) {
            revert UnknownReserve(asset);
        }

        MockAToken(aToken).burn(msg.sender, amount);
        IERC20(asset).safeTransfer(to, amount);
        return amount;
    }

    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata interestRateModes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external {
        interestRateModes;
        onBehalfOf;
        referralCode;

        if (assets.length != 1) {
            revert UnsupportedMultiAssetFlashLoan();
        }

        IERC20 asset = IERC20(assets[0]);
        uint256 amount = amounts[0];

        asset.safeTransfer(receiverAddress, amount);

        bool success = IAaveFlashLoanReceiver(receiverAddress).executeOperation(
            assets,
            amounts,
            new uint256[](1),
            msg.sender,
            params
        );

        if (!success) {
            revert FlashLoanCallbackFailed();
        }

        asset.safeTransferFrom(receiverAddress, address(this), amount);
    }
}
