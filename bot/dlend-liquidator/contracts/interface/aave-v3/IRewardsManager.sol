// SPDX-License-Identifier: GNU AGPLv3
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

pragma solidity ^0.8.0;

import "./../../../lending/core/interfaces/IAaveIncentivesController.sol";

interface IRewardsManager {
    function initialize(address _morpho) external;

    function getUserIndex(address, address) external returns (uint256);

    function getUserUnclaimedRewards(
        address[] calldata,
        address
    ) external view returns (uint256);

    function claimRewards(
        IAaveIncentivesController _aaveIncentivesController,
        address[] calldata,
        address
    ) external returns (uint256);

    function updateUserAssetAndAccruedRewards(
        IAaveIncentivesController _aaveIncentivesController,
        address _user,
        address _asset,
        uint256 _userBalance,
        uint256 _totalBalance
    ) external;
}
