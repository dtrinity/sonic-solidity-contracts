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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/dstable/AmoVault.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract MockAmoVault is AmoVault {
    using SafeERC20 for IERC20;

    uint256 private fakeDeFiCollateralValue;

    constructor(
        address _dstable,
        address _amoManager,
        address _admin,
        address _collateralWithdrawer,
        address _recoverer,
        IPriceOracleGetter _oracle
    )
        AmoVault(
            _dstable,
            _amoManager,
            _admin,
            _collateralWithdrawer,
            _recoverer,
            _oracle
        )
    {}

    // Override totalCollateralValue to return the sum of all simulated values
    function totalCollateralValue() public view override returns (uint256) {
        return _totalValueOfSupportedCollaterals() + fakeDeFiCollateralValue;
    }

    // Override totalDstableValue to return the sum of all simulated values
    function totalDstableValue() public view override returns (uint256) {
        uint256 dstableBalance = dstable.balanceOf(address(this));
        uint256 dstablePrice = oracle.getAssetPrice(address(dstable));
        uint256 dstableValue = (dstableBalance * dstablePrice) /
            (10 ** dstableDecimals);

        return dstableValue;
    }

    function totalValue() public view override returns (uint256) {
        return totalCollateralValue() + totalDstableValue();
    }

    // Simulate AmoVault losing some value
    function mockRemoveAsset(address asset, uint256 amount) external {
        IERC20(asset).safeTransfer(
            address(0x000000000000000000000000000000000000dEaD), // Arbitrary black hole address
            amount
        );
    }

    // Simulate fake DeFi returns
    function getFakeDeFiCollateralValue() external view returns (uint256) {
        return fakeDeFiCollateralValue;
    }

    // Set fake DeFi collateral value
    function setFakeDeFiCollateralValue(uint256 value) external {
        fakeDeFiCollateralValue = value;
    }
}
