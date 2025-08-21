# Step 2: Create Solidity Contracts Sub-repository

## Objective
Set up the `bot-solidity-contracts` sub-repository with the same structure and configuration as the main Solidity contract repository.

## Tasks
1. Create `bot-solidity-contracts` directory structure
2. Copy configuration files from main repository:
   - `package.json`
   - `hardhat.config.ts`
   - `tsconfig.json`
   - `jest.config.ts`
   - `.solhint.json`
   - `.solhintignore`
   - `.yarnrc.yml`
   - `.env.example`
3. Create required directories:
   - `contracts/`
   - `test/`
   - `deploy/`
   - `config/`
4. Set up yarn dependencies
5. Create README.md with project information

## Implementation Details
- The sub-repo should be completely independent and work standalone
- Follow the same linting and testing setup as the main repository
- Use Hardhat as the development framework
- Ensure all necessary dependencies are installed

## Expected Outcome
A fully functional Solidity contract development environment that mirrors the main repository's setup, ready for implementing the flashloan-based reward compounding contracts.