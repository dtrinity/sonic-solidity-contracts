# Step 3: Implement Flashloan-based Reward Compounding Contracts

## Objective
Create the Solidity contracts for the flashloan-based reward compounding functionality, including both base and venue-specific implementations.

## Tasks
1. Create `RewardCompounderDLendBase.sol` contract:
   - Implement base flashloan functionality
   - Add reward compounding logic
   - Include proper error handling and events
2. Create `RewardCompounderDLendOdos.sol` contract:
   - Extend the base contract
   - Implement Odos-specific swap functionality
   - Handle exact-out swaps for collateral acquisition
3. Implement proper interfaces and libraries
4. Add documentation and NatSpec comments

## Implementation Details
- Follow the pattern from `FlashMintLiquidatorAaveBorrowRepayBase.sol` and `FlashMintLiquidatorAaveBorrowRepayOdos.sol`
- Implement ERC3156 flashloan callback functionality
- Handle the reward compounding flow as described in `flashloan-reward-compounding-explanation.md`:
  - Determine target shares = exchangeThreshold
  - Compute required collateral to mint exactly shares
  - Use flashloan to acquire collateral via exact-out swap
  - Mint shares and receive borrowed dUSD
  - Call compoundRewards with shares to claim dUSD rewards
  - Repay flashloan and keep surplus as profit
- Ensure proper approvals and error checking throughout the process

## Expected Outcome
Fully implemented flashloan-based reward compounding contracts that can be deployed and used to compound DLoopCoreDLend rewards via flashloans.