# DLoop Reward Compounder Bot File Structure

This document outlines the complete file structure that will be created for the DLoop reward compounder bot.

## Root Directory
```
bot/dloop-reward-compounder/
├── .git/ (git repository)
├── .gitignore
├── README.md
├── bot-solidity-contracts/
└── bot-typescript/
```

## Solidity Contracts Sub-repository
```
bot-solidity-contracts/
├── contracts/
│   ├── RewardCompounderDLendBase.sol
│   ├── RewardCompounderDLendOdos.sol
│   ├── RewardQuoteHelperBase.sol
│   ├── RewardQuoteHelperDLend.sol
│   ├── mock/
│   │   ├── RewardCompounderDLendMock.sol
│   │   ├── RewardQuoteHelperMock.sol
│   │   └── DLoopCoreMock.sol
│   └── interface/
├── test/
│   ├── reward-compounder.test.ts
│   ├── reward-quote-helper.test.ts
│   └── mock/
├── deploy/
│   ├── deploy-reward-compounder-dlend-odos.ts
│   └── deploy-reward-quote-helper-dlend.ts
├── config/
│   ├── networks/
│   │   ├── sonic_mainnet.ts
│   │   └── sonic_testnet.ts
│   └── index.ts
├── package.json
├── hardhat.config.ts
├── tsconfig.json
├── Makefile
├── jest.config.ts
├── .solhint.json
├── .solhintignore
├── .yarnrc.yml
├── .yarn/
├── .env.example
└── README.md
```

## TypeScript Bot Sub-repository
```
bot-typescript/
├── src/
│   ├── runner.ts
│   ├── rewardQuoter.ts
│   ├── rewardCompounder.ts
│   ├── notification.ts
│   └── types/
├── test/
│   ├── rewardQuoter.test.ts
│   ├── rewardCompounder.test.ts
│   ├── notification.test.ts
│   ├── runner.test.ts
│   └── __mocks__/
├── config/
│   ├── networks/
│   │   ├── sonic_mainnet.ts
│   │   └── sonic_testnet.ts
│   └── index.ts
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

## AI Plan Directory
```
ai-plan/dloop-reward-compounder/qwen/
├── overview.md
├── summary.md
├── test-plan.md
├── review-checklist.md
└── steps/
    ├── 01-initialize-git-repo.md
    ├── 02-create-solidity-contracts-subrepo.md
    ├── 03-implement-flashloan-reward-compounding-contracts.md
    ├── 04-implement-reward-quoting-helper-contracts.md
    ├── 05-create-deployment-scripts.md
    ├── 06-implement-tests.md
    ├── 07-create-typescript-bot-subrepo.md
    ├── 08-implement-bot-runner.md
    ├── 09-implement-reward-quoting-logic.md
    ├── 10-implement-reward-compounding-logic.md
    ├── 11-implement-notification-system.md
    ├── 12-write-tests-for-typescript-bot.md
    ├── 13-create-docker-configuration.md
    └── 14-final-integration-and-testing.md
```