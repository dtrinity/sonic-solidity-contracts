// SPDX-License-Identifier: AGPL-3.0
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

import {IAaveOracle} from "contracts/dlend/core/interfaces/IAaveOracle.sol";
import {ITransferStrategyBase} from "../interfaces/ITransferStrategyBase.sol";

library RewardsDataTypes {
    struct RewardsConfigInput {
        uint88 emissionPerSecond;
        uint256 totalSupply;
        uint32 distributionEnd;
        address asset;
        address reward;
        ITransferStrategyBase transferStrategy;
        IAaveOracle rewardOracle;
    }

    struct UserAssetBalance {
        address asset;
        uint256 userBalance;
        uint256 totalSupply;
    }

    struct UserData {
        // Liquidity index of the reward distribution for the user
        uint104 index;
        // Amount of accrued rewards for the user since last user index update
        uint128 accrued;
    }

    struct RewardData {
        // Liquidity index of the reward distribution
        uint104 index;
        // Amount of reward tokens distributed per second
        uint88 emissionPerSecond;
        // Timestamp of the last reward index update
        uint32 lastUpdateTimestamp;
        // The end of the distribution of rewards (in seconds)
        uint32 distributionEnd;
        // Map of user addresses and their rewards data (userAddress => userData)
        mapping(address => UserData) usersData;
    }

    struct AssetData {
        // Map of reward token addresses and their data (rewardTokenAddress => rewardData)
        mapping(address => RewardData) rewards;
        // List of reward token addresses for the asset
        mapping(uint128 => address) availableRewards;
        // Count of reward tokens for the asset
        uint128 availableRewardsCount;
        // Number of decimals of the asset
        uint8 decimals;
    }
}
