# Step 9: Implement Reward Quoting Logic

## Objective
Implement the TypeScript logic for interacting with the reward quoting helper contracts to determine if reward compounding is profitable.

## Tasks
1. Create `src/rewardQuoter.ts` module:
   - Implement functions to call reward quoting helper contracts
   - Add logic to calculate profitability
   - Include proper error handling
2. Set up contract interaction with ethers.js/typechain
3. Implement threshold checking logic:
   - Compare reward value after treasury fee
   - Check against exchange threshold
   - Determine if compounding is profitable

## Implementation Details
- Integrate with the deployed RewardQuoteHelperDLend contract
- Use typechain for type-safe contract interactions
- Implement proper error handling for contract calls
- Follow the profitability logic described in the requirements:
  - Check if reward value (after treasury fee) is more than the $ value of exchange assets plus gas fee
  - Use exchangeThreshold from RewardClaimable.sol
- Cache contract instances for efficiency

## Expected Outcome
A fully functional reward quoting module that can accurately determine if reward compounding is profitable before executing the flashloan operation.