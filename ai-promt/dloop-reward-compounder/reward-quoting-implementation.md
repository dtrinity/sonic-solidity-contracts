## **Complete Reward Helper Contract Implementation**

Here's the complete Solidity implementation for a reward helper contract that can be integrated into your bot:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RewardHelper
 * @notice Helper contract for querying dLEND protocol rewards
 * @dev Provides efficient reward querying functions for bot operations
 * @author Your Bot Implementation
 */

import {IPool} from "contracts/dlend/core/interfaces/IPool.sol";
import {IPoolAddressesProvider} from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import {IncentivizedERC20} from "contracts/dlend/core/protocol/tokenization/base/IncentivizedERC20.sol";
import {IRewardsDistributor} from "contracts/dlend/periphery/rewards/interfaces/IRewardsDistributor.sol";
import {IERC20} from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

contract RewardHelper {
    /// @notice Address of the dLEND pool
    IPool public immutable POOL;
    
    /// @notice Address of the rewards controller (also acts as rewards distributor)
    IRewardsDistributor public immutable REWARDS_CONTROLLER;
    
    /// @notice Address provider for getting contract addresses
    IPoolAddressesProvider public immutable ADDRESS_PROVIDER;

    /// @notice Thrown when an invalid address is provided
    error InvalidAddress();
    
    /// @notice Thrown when no rewards are found for a user
    error NoRewardsFound();
    
    /// @notice Thrown when reward query fails
    error RewardQueryFailed();

    constructor(
        address _poolAddress,
        address _rewardsControllerAddress,
        address _addressProviderAddress
    ) {
        if (_poolAddress == address(0) || 
            _rewardsControllerAddress == address(0) || 
            _addressProviderAddress == address(0)) {
            revert InvalidAddress();
        }
        
        POOL = IPool(_poolAddress);
        REWARDS_CONTROLLER = IRewardsDistributor(_rewardsControllerAddress);
        ADDRESS_PROVIDER = IPoolAddressesProvider(_addressProviderAddress);
    }

    /**
     * @notice Get accrued rewards for a specific user and reward token
     * @param user The address of the user to query rewards for
     * @param rewardToken The address of the reward token (e.g., dUSD)
     * @return The amount of accrued rewards (already earned but not claimed)
     */
    function getUserAccruedRewards(
        address user,
        address rewardToken
    ) external view returns (uint256) {
        if (user == address(0) || rewardToken == address(0)) {
            revert InvalidAddress();
        }
        
        return REWARDS_CONTROLLER.getUserAccruedRewards(user, rewardToken);
    }

    /**
     * @notice Get total rewards (accrued + pending) for a user across specific assets
     * @param user The address of the user to query rewards for
     * @param assets Array of asset addresses the user has positions in
     * @param rewardToken The address of the reward token (e.g., dUSD)
     * @return The total amount of rewards (accrued + pending)
     */
    function getUserTotalRewards(
        address user,
        address[] calldata assets,
        address rewardToken
    ) external view returns (uint256) {
        if (user == address(0) || rewardToken == address(0)) {
            revert InvalidAddress();
        }
        if (assets.length == 0) {
            revert InvalidAddress();
        }
        
        return REWARDS_CONTROLLER.getUserRewards(assets, user, rewardToken);
    }

    /**
     * @notice Get all rewards for a user across all assets and reward tokens
     * @param user The address of the user to query rewards for
     * @param assets Array of asset addresses the user has positions in
     * @return rewardTokens Array of reward token addresses
     * @return rewardAmounts Array of corresponding reward amounts
     */
    function getAllUserRewards(
        address user,
        address[] calldata assets
    ) external view returns (
        address[] memory rewardTokens,
        uint256[] memory rewardAmounts
    ) {
        if (user == address(0)) {
            revert InvalidAddress();
        }
        if (assets.length == 0) {
            revert InvalidAddress();
        }
        
        return REWARDS_CONTROLLER.getAllUserRewards(assets, user);
    }

    /**
     * @notice Get rewards for a user across all available reserves
     * @param user The address of the user to query rewards for
     * @param rewardToken The address of the reward token (e.g., dUSD)
     * @return The total amount of rewards across all reserves
     */
    function getUserRewardsAllReserves(
        address user,
        address rewardToken
    ) external view returns (uint256) {
        if (user == address(0) || rewardToken == address(0)) {
            revert InvalidAddress();
        }
        
        address[] memory reserves = POOL.getReservesList();
        return REWARDS_CONTROLLER.getUserRewards(reserves, user, rewardToken);
    }

    /**
     * @notice Get comprehensive reward information for a user
     * @param user The address of the user to query rewards for
     * @return totalAccruedRewards Total accrued rewards across all tokens
     * @return rewardTokens Array of all reward token addresses
     * @return accruedAmounts Array of accrued amounts for each token
     */
    function getUserRewardSummary(
        address user
    ) external view returns (
        uint256 totalAccruedRewards,
        address[] memory rewardTokens,
        uint256[] memory accruedAmounts
    ) {
        if (user == address(0)) {
            revert InvalidAddress();
        }
        
        rewardTokens = REWARDS_CONTROLLER.getRewardsList();
        accruedAmounts = new uint256[](rewardTokens.length);
        totalAccruedRewards = 0;
        
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            accruedAmounts[i] = REWARDS_CONTROLLER.getUserAccruedRewards(
                user, 
                rewardTokens[i]
            );
            totalAccruedRewards += accruedAmounts[i];
        }
        
        if (totalAccruedRewards == 0) {
            revert NoRewardsFound();
        }
    }

    /**
     * @notice Get rewards for a specific asset token (aToken/vToken/sToken)
     * @param user The address of the user to query rewards for
     * @param assetToken The address of the asset token (aToken/vToken/sToken)
     * @param rewardToken The address of the reward token (e.g., dUSD)
     * @return The amount of rewards for this specific asset token
     */
    function getUserRewardsForAsset(
        address user,
        address assetToken,
        address rewardToken
    ) external view returns (uint256) {
        if (user == address(0) || assetToken == address(0) || rewardToken == address(0)) {
            revert InvalidAddress();
        }
        
        address[] memory assets = new address[](1);
        assets[0] = assetToken;
        
        return REWARDS_CONTROLLER.getUserRewards(assets, user, rewardToken);
    }

    /**
     * @notice Check if a user has any rewards across all tokens
     * @param user The address of the user to check
     * @return hasRewards True if user has any rewards, false otherwise
     * @return totalRewardValue Total value of all accrued rewards
     */
    function hasUserRewards(
        address user
    ) external view returns (bool hasRewards, uint256 totalRewardValue) {
        if (user == address(0)) {
            revert InvalidAddress();
        }
        
        address[] memory rewardTokens = REWARDS_CONTROLLER.getRewardsList();
        totalRewardValue = 0;
        
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            uint256 accrued = REWARDS_CONTROLLER.getUserAccruedRewards(
                user, 
                rewardTokens[i]
            );
            totalRewardValue += accrued;
        }
        
        hasRewards = totalRewardValue > 0;
    }

    /**
     * @notice Get the list of all reward tokens available in the system
     * @return Array of reward token addresses
     */
    function getAllRewardTokens() external view returns (address[] memory) {
        return REWARDS_CONTROLLER.getRewardsList();
    }

    /**
     * @notice Get reward tokens available for a specific asset
     * @param asset The address of the asset to query
     * @return Array of reward token addresses for this asset
     */
    function getRewardTokensForAsset(
        address asset
    ) external view returns (address[] memory) {
        if (asset == address(0)) {
            revert InvalidAddress();
        }
        
        return REWARDS_CONTROLLER.getRewardsByAsset(asset);
    }

    /**
     * @notice Get all reserves in the pool
     * @return Array of reserve addresses
     */
    function getAllReserves() external view returns (address[] memory) {
        return POOL.getReservesList();
    }
}
```

## **📋 Implementation Plan Integration**

### **1. Contract Deployment**

- Deploy `RewardHelper` contract with correct dLEND addresses
- Constructor parameters:
  - `_poolAddress`: dLEND pool contract address
  - `_rewardsControllerAddress`: RewardsController contract address  
  - `_addressProviderAddress`: PoolAddressesProvider contract address

### **2. Integration with Bot**

```solidity
// In your main bot contract
contract YourBot {
    RewardHelper public immutable rewardHelper;
    
    constructor(address rewardHelperAddress) {
        rewardHelper = RewardHelper(rewardHelperAddress);
    }
    
    function checkUserRewards(address user, address rewardToken) external view {
        uint256 accruedRewards = rewardHelper.getUserAccruedRewards(user, rewardToken);
        uint256 totalRewards = rewardHelper.getUserRewardsAllReserves(user, rewardToken);
        
        // Your bot logic here
        if (accruedRewards > MIN_CLAIM_THRESHOLD) {
            // Trigger reward claiming logic
        }
    }
}
```

### **3. Usage Examples**

#### **Example 1: Check dUSD Rewards**

```solidity
address user = 0x123...;
address dUSD = 0x456...;

// Get accrued dUSD rewards
uint256 accrued = rewardHelper.getUserAccruedRewards(user, dUSD);

// Get total dUSD rewards (accrued + pending)
address[] memory allReserves = rewardHelper.getAllReserves();
uint256 total = rewardHelper.getUserTotalRewards(user, allReserves, dUSD);
```

#### **Example 2: Get All Rewards**

```solidity
address user = 0x123...;
address[] memory reserves = rewardHelper.getAllReserves();

(rewardTokens, rewardAmounts) = rewardHelper.getAllUserRewards(user, reserves);

// Process all rewards
for (uint256 i = 0; i < rewardTokens.length; i++) {
    if (rewardAmounts[i] > 0) {
        // Handle reward token at rewardTokens[i] with amount rewardAmounts[i]
    }
}
```

#### **Example 3: Quick Reward Check**

```solidity
(bool hasRewards, uint256 totalValue) = rewardHelper.hasUserRewards(user);
if (hasRewards) {
    // User has rewards worth totalValue
    // Trigger claiming or notification logic
}
```

### **4. Gas Optimization Notes**

- Use `getUserAccruedRewards()` for fast checks (only accrued, no pending calculation)
- Use `getAllUserRewards()` sparingly as it queries all reward tokens
- Cache reserve lists if called frequently
- Consider batching multiple reward queries in a single transaction

### **5. Error Handling**

- Always check for `InvalidAddress()` errors
- Handle `NoRewardsFound()` when user has no rewards
- Consider `RewardQueryFailed()` in production environments

This helper contract provides a clean, efficient interface for bot operations while maintaining compatibility with the existing dLEND reward system.
