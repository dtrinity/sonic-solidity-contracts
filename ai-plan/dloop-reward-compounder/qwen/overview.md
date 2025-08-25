# DLoop Reward Compounder Bot Implementation Plan Overview

## Overview

This document provides an overview of the implementation plan for the DLoop reward compounder bot. The bot consists of two independent sub-repositories:

1. `bot-solidity-contracts`: Contains the Solidity smart contracts for the flashloan-based reward compounding and reward quoting functionality
2. `bot-typescript`: Contains the TypeScript bot logic that orchestrates the reward compounding process

## Implementation Steps

The implementation will be carried out in the following steps:

1. **Initialize Git Repository** - Set up git in the main directory
2. **Create Solidity Contracts Sub-repo** - Implement the Solidity contracts with Hardhat setup
3. **Implement Flashloan-based Reward Compounding Contracts** - Create the base and venue-specific contracts
4. **Implement Reward Quoting Helper Contracts** - Create the base and venue-specific contracts
5. **Create Deployment Scripts** - Write deployment scripts for both contract sets
6. **Implement Tests** - Write comprehensive tests for all contracts
7. **Create TypeScript Bot Logic Sub-repo** - Implement the TypeScript bot with proper setup
8. **Implement Bot Runner** - Create the main entry point for the bot
9. **Implement Reward Quoting Logic** - Integrate with the reward quoting helper contract
10. **Implement Reward Compounding Logic** - Integrate with the flashloan-based periphery contract
11. **Implement Notification System** - Add Slack notifications for bot actions
12. **Write Tests for TypeScript Bot** - Create comprehensive tests with proper mocking
13. **Create Docker Configuration** - Set up Docker for the TypeScript bot
14. **Final Integration and Testing** - Ensure both sub-repos work together correctly

## Directory Structure

```
bot/dloop-reward-compounder/
├── bot-solidity-contracts/
│   ├── contracts/
│   ├── test/
│   ├── deploy/
│   ├── config/
│   ├── package.json
│   ├── hardhat.config.ts
│   ├── tsconfig.json
│   ├── Makefile
│   ├── jest.config.ts
│   ├── .solhint.json
│   ├── .solhintignore
│   ├── .yarnrc.yml
│   ├── .yarn/
│   ├── .env.example
│   └── README.md
└── bot-typescript/
    ├── src/
    ├── test/
    ├── config/
    ├── Dockerfile
    ├── Makefile
    ├── package.json
    ├── tsconfig.json
    ├── eslint.config.mjs
    ├── jest.config.js
    ├── .yarnrc.yml
    ├── .yarn/
    ├── .env.example
    └── README.md
```

## How to Work Through the Plan

1. Start with Step 1: Initialize the git repository in the main directory
2. Proceed with implementing the Solidity contracts sub-repo (Steps 2-6)
3. Then implement the TypeScript bot logic sub-repo (Steps 7-13)
4. Finally, perform integration testing (Step 14)

Each step focuses on a specific part of the implementation to avoid confusion and ensure proper separation of concerns between the two sub-repositories.