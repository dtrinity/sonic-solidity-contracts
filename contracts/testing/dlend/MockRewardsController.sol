// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/vaults/dloop/core/venue/dlend/interface/IRewardsController.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockRewardsController is IRewardsController {
    using SafeERC20 for IERC20;

    // reward token => emission amount to transfer on each claim
    mapping(address => uint256) public emission;
    address public rewardSource; // from where to transfer rewards

    constructor(address rewardSource_) {
        rewardSource = rewardSource_;
    }

    function setEmission(address rewardToken, uint256 amount) external {
        emission[rewardToken] = amount;
    }

    function claimRewards(
        address[] calldata assets,
        uint256 amount,
        address to,
        address reward
    ) external override returns (uint256) {
        assets;
        amount; // unused in mock
        uint256 e = emission[reward];
        if (e > 0) {
            IERC20(reward).safeTransferFrom(rewardSource, to, e);
            return e;
        }
        return 0;
    }

    function claimRewardsOnBehalf(
        address[] calldata assets,
        uint256 amount,
        address user,
        address to,
        address reward
    ) external override returns (uint256) {
        assets;
        amount;
        user; // unused in mock
        uint256 e = emission[reward];
        if (e > 0) {
            IERC20(reward).safeTransferFrom(rewardSource, to, e);
            return e;
        }
        return 0;
    }

    function claimRewardsToSelf(
        address[] calldata assets,
        uint256 amount,
        address reward
    ) external override returns (uint256) {
        assets;
        amount; // unused
        uint256 e = emission[reward];
        if (e > 0) {
            IERC20(reward).safeTransferFrom(rewardSource, msg.sender, e);
            return e;
        }
        return 0;
    }

    function claimAllRewards(
        address[] calldata assets,
        address to
    )
        external
        override
        returns (address[] memory rewardsList, uint256[] memory claimedAmounts)
    {
        assets;
        to; // not needed for this test mock
        rewardsList = new address[](0);
        claimedAmounts = new uint256[](0);
    }

    function claimAllRewardsOnBehalf(
        address[] calldata assets,
        address user,
        address to
    )
        external
        override
        returns (address[] memory rewardsList, uint256[] memory claimedAmounts)
    {
        assets;
        user;
        to;
        rewardsList = new address[](0);
        claimedAmounts = new uint256[](0);
    }

    function claimAllRewardsToSelf(
        address[] calldata assets
    )
        external
        override
        returns (address[] memory rewardsList, uint256[] memory claimedAmounts)
    {
        assets;
        rewardsList = new address[](0);
        claimedAmounts = new uint256[](0);
    }
}
