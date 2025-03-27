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

import {IPullRewardsTransferStrategy} from "../interfaces/IPullRewardsTransferStrategy.sol";
import {ITransferStrategyBase} from "../interfaces/ITransferStrategyBase.sol";
import {TransferStrategyBase} from "./TransferStrategyBase.sol";
import {GPv2SafeERC20} from "contracts/dlend/core/dependencies/gnosis/contracts/GPv2SafeERC20.sol";
import {IERC20} from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title PullRewardsTransferStrategy
 * @notice Transfer strategy that pulls ERC20 rewards from an external account to the user address.
 * The external account could be a smart contract or EOA that must approve to the PullRewardsTransferStrategy contract address.
 * @author Aave
 **/
contract PullRewardsTransferStrategy is
    TransferStrategyBase,
    IPullRewardsTransferStrategy
{
    using GPv2SafeERC20 for IERC20;

    address internal immutable REWARDS_VAULT;

    constructor(
        address incentivesController,
        address rewardsAdmin,
        address rewardsVault
    ) TransferStrategyBase(incentivesController, rewardsAdmin) {
        REWARDS_VAULT = rewardsVault;
    }

    /// @inheritdoc TransferStrategyBase
    function performTransfer(
        address to,
        address reward,
        uint256 amount
    )
        external
        override(TransferStrategyBase, ITransferStrategyBase)
        onlyIncentivesController
        returns (bool)
    {
        IERC20(reward).safeTransferFrom(REWARDS_VAULT, to, amount);

        return true;
    }

    /// @inheritdoc IPullRewardsTransferStrategy
    function getRewardsVault() external view returns (address) {
        return REWARDS_VAULT;
    }
}
