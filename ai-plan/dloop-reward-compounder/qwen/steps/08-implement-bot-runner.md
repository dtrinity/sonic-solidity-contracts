# Step 8: Implement Bot Runner

## Objective
Create the main entry point for the TypeScript bot that orchestrates the reward compounding process.

## Tasks
1. Create `src/runner.ts` as the main entry point
2. Implement command-line argument parsing for network selection
3. Set up configuration loading based on network
4. Implement the main bot loop
5. Add proper error handling and logging

## Implementation Details
- Follow the pattern from `bot/dlend-liquidator/typescript/` for structure
- Implement a runner that can be invoked with `make run network=<network>`
- Load network-specific configurations from `config/networks/`
- Implement proper logging and error handling
- Ensure the runner can be easily extended for additional functionality

## Expected Outcome
A functional bot runner that can be executed to start the reward compounding process, with proper network configuration handling and error management.