# Step 5: Create Deployment Scripts

## Objective
Create deployment scripts for both the flashloan-based reward compounding contracts and the reward quoting helper contracts.

## Tasks
1. Create deployment scripts in `bot-solidity-contracts/deploy/`:
   - `deploy-reward-compounder-dlend-odos.ts` for RewardCompounderDLendOdos
   - `deploy-reward-quote-helper-dlend.ts` for RewardQuoteHelperDLend
2. Set up network configurations in `bot-solidity-contracts/config/networks/`:
   - `sonic_mainnet.ts`
   - `sonic_testnet.ts`
3. Implement proper constructor parameter handling
4. Add verification scripts for deployed contracts

## Implementation Details
- Follow the deployment pattern from the main repository's `deploy/` directory
- Use Hardhat's deployment utilities
- Handle different network configurations properly
- Include proper error handling and logging
- Ensure contracts are properly verified on block explorers
- Set up proper constructor parameters based on network configurations

## Expected Outcome
Deployment scripts that can deploy both contract sets to Sonic mainnet and testnet with proper configuration and verification.