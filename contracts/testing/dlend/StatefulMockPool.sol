// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { DataTypes } from "contracts/vaults/dloop/core/venue/dlend/interface/types/DataTypes.sol";
import { IAaveFlashLoanReceiver } from "contracts/dlend/periphery/adapters/curve/interfaces/IAaveFlashLoanReceiver.sol";
import { MockAToken } from "./MockAToken.sol";
import { IWithdrawHook } from "./IWithdrawHook.sol";
import { TestMintableERC20 } from "../token/TestMintableERC20.sol";

contract StatefulMockPool {
    using SafeERC20 for IERC20;

    struct ReserveConfig {
        address reserveManager;
        address withdrawHook;
        uint256 flashLoanPremiumBps;
        uint256 extraCollateralOnWithdraw;
    }

    struct FlashLoanTemp {
        address assetAddress;
        uint256 amount;
        uint256 premium;
        uint256 totalOwed;
    }

    mapping(address => DataTypes.ReserveData) private _reserves;
    mapping(address => ReserveConfig) private _reserveConfigs;
    address[] private _reservesList;

    error UnknownReserve(address asset);
    error FlashLoanCallbackFailed();
    error UnsupportedMultiAssetFlashLoan();
    error ArrayLengthMismatch();

    event ReserveConfigured(
        address indexed asset,
        address indexed reserveManager,
        address indexed withdrawHook,
        uint256 flashLoanPremiumBps,
        uint256 extraCollateralOnWithdraw
    );

    event FlashLoanExecuted(
        address indexed receiver,
        address indexed asset,
        uint256 amount,
        uint256 premium
    );

    event FlashLoanRepaid(
        address indexed payer,
        address indexed asset,
        uint256 amount
    );

    event ReserveBurned(
        address indexed asset,
        address indexed reserveManager,
        uint256 amount
    );

    event WithdrawPerformed(
        address indexed asset,
        address indexed caller,
        address indexed recipient,
        uint256 requestedAmount,
        uint256 transferredAmount
    );

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

    function configureReserve(
        address asset,
        address reserveManager,
        address withdrawHook,
        uint256 flashLoanPremiumBps,
        uint256 extraCollateralOnWithdraw
    ) external {
        ReserveConfig storage cfg = _reserveConfigs[asset];
        cfg.reserveManager = reserveManager;
        cfg.withdrawHook = withdrawHook;
        cfg.flashLoanPremiumBps = flashLoanPremiumBps;
        cfg.extraCollateralOnWithdraw = extraCollateralOnWithdraw;

        emit ReserveConfigured(asset, reserveManager, withdrawHook, flashLoanPremiumBps, extraCollateralOnWithdraw);
    }

    function getReserveData(address asset) external view returns (DataTypes.ReserveData memory) {
        return _reserves[asset];
    }

    function getReserveConfig(address asset) external view returns (ReserveConfig memory) {
        return _reserveConfigs[asset];
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

        ReserveConfig memory cfg = _reserveConfigs[asset];
        uint256 transferAmount = amount + cfg.extraCollateralOnWithdraw;
        address recipient = cfg.withdrawHook == address(0) ? to : cfg.withdrawHook;

        uint256 poolBalance = IERC20(asset).balanceOf(address(this));
        if (poolBalance < transferAmount) {
            TestMintableERC20(asset).mint(address(this), transferAmount - poolBalance);
        }

        IERC20(asset).safeTransfer(recipient, transferAmount);

        if (cfg.reserveManager != address(0) && cfg.extraCollateralOnWithdraw > 0) {
            emit ReserveBurned(asset, cfg.reserveManager, cfg.extraCollateralOnWithdraw);
        }

        if (cfg.withdrawHook != address(0)) {
            IWithdrawHook(cfg.withdrawHook).onWithdraw(asset, msg.sender, to, transferAmount);
        }

        emit WithdrawPerformed(asset, msg.sender, recipient, amount, transferAmount);
        return transferAmount;
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
        onBehalfOf;
        referralCode;

        if (assets.length != amounts.length || assets.length != interestRateModes.length) {
            revert ArrayLengthMismatch();
        }

        if (assets.length != 1) {
            revert UnsupportedMultiAssetFlashLoan();
        }

        FlashLoanTemp memory temp;
        temp.assetAddress = assets[0];
        temp.amount = amounts[0];
        temp.premium = (temp.amount * _reserveConfigs[temp.assetAddress].flashLoanPremiumBps) / 10_000;

        IERC20(temp.assetAddress).safeTransfer(receiverAddress, temp.amount);

        uint256[] memory premiums = _buildPremiumArray(temp.premium);

        if (!_executeOperation(receiverAddress, assets, amounts, premiums, params)) {
            revert FlashLoanCallbackFailed();
        }

        temp.totalOwed = temp.amount + temp.premium;
        IERC20(temp.assetAddress).safeTransferFrom(receiverAddress, address(this), temp.totalOwed);

        emit FlashLoanExecuted(receiverAddress, temp.assetAddress, temp.amount, temp.premium);
        emit FlashLoanRepaid(receiverAddress, temp.assetAddress, temp.totalOwed);
    }

    function _buildPremiumArray(uint256 premium) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = premium;
        return arr;
    }

    function _executeOperation(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] memory premiums,
        bytes calldata params
    ) internal returns (bool) {
        return IAaveFlashLoanReceiver(receiverAddress).executeOperation(
            assets,
            amounts,
            premiums,
            msg.sender,
            params
        );
    }
}
