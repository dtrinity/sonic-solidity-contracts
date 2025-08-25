# Prompt to generate the implementation plan for the dloop-reward-compounder bot

I want to implement a bot to perform reward compounding calls on DLoopCoreDLend, via flashloan-based periphery contract.

- This periphery is not existing yet and we need to implement and deploy it.

Please generate an implementation plan and test-plan (with mock test cases) for the bot, based on the following requirements.

## Overview

The bot repo directory is in `bot/dloop-reward-compounder`, which has the following structure:

- `bot-solidity-contracts/`: the contract repo.
- `bot-typescript/`: the bot logic.

These 2 sub-repos should be independent to each other.

The `bot-solidity-contracts` repo should have the same setup to a contract-only repo with Hardhat. Reference the current `./` repo (sonic-solidity-contracts).

The `bot-typescript` repo should have the same setup to a Typescript repo with `yarn`, `ts-node`, `docker`, `eslint` and `jest`. Reference the current `./` repo.

The bot repo should be independent to `./` repo, means if I move the `bot/dloop-reward-compounder` out of `./`, it still work fine without any installation, dependencies issue.

## Sub-repo structure and expected content

Git should be initialized in `./bot/dloop-reward-compounder` directory. Which means this git will track the changes in both sub-repos.

- `cd ./bot/dloop-reward-compounder && git init`

### Bot Solidity contract

The bot contracts will be implemented and deployed in `bot/dloop-reward-compounder/bot-solidity-contracts/` which has the same setup to a Solidity contract-only repo with Hardhat. It should consists of:

- The flashloan-based periphery contract (reference: `ai-promt/dloop-reward-compounder/flashloan-reward-compounding-explanation.md`)
- The reward quoting helper contract (reference: `ai-promt/dloop-reward-compounder/reward-quoting-implementation.md`)

Reference the current `.` repo (sonic-solidity-contracts).

Use `hardhat` as the framework.

This sub-repo should have:

- `contracts`: put all `.sol` files in this directory.
- `test`: put all hardhat-based tests files here. Reference a hardhat-based test file in `test/dloop/DLoopCoreMock/inflation-attack-test.ts`
- `deploy`: put all deploy scripts here. Reference `./deploy`
- `config`: put all per network config files here. Reference `./config/networks`
- No Docker setup in this sub-repo.
- And other related files/directories. Reference `./` repo

Make sure it follow the Solidity linting with `solhint` in `./` repo.

`Makefile` should have the following targets:

- `make compile`
- `make lint`
- `make test`
- `make deploy-contracts.sonic_mainnet`
- `make deploy-contracts.sonic_testnet`

The contract logic should be abstracted to `Base` and venue-specific contracts:

- For the flashloan-based periphery contract:
  - Abstract base: `RewardCompounderDLendBase.sol` (reference `bot/dlend-liquidator/contracts/aave-v3/FlashMintLiquidatorAaveBorrowRepayBase.sol`)
  - Venue-specific: `RewardCompounderDLendOdos.sol` (Odos is the swap venue, reference `bot/dlend-liquidator/contracts/aave-v3/FlashMintLiquidatorAaveBorrowRepayOdos.sol`)
- For the reward quoting helper contract:
  - Abstract base: `RewardQuoteHelperBase.sol`
  - Venue-specific: `RewardQuoteHelperDLend.sol` (DLend is the lending protocl venue, reference `contracts/vaults/dloop/core/venue/dlend/DLoopCoreDLend.sol`)

Expected structure:

- `contracts`: put all `.sol` files in this directory.
- `test`: put all hardhat-based tests files here. Reference a hardhat-based test file in `test/dloop/DLoopCoreMock/inflation-attack-test.ts`
- `deploy`: put all deploy scripts here. Reference `./deploy`
- `config`: put all per network config files here. Reference `./config/networks`
- And other related files/directories. Reference `./` repo
- `package.json`: put the package.json here.
- `tsconfig.json`: put the tsconfig.json here.
- `Makefile`
- `jest.config.ts`: put the jest.config.ts here. (to run Hardhat tests)
- `hardhat.config.ts`: put the hardhat.config.ts here.
- `.solhint.json`: put the .solhint.json here.
- `.solhintignore`: put the .solhintignore here.
- `.yarnrc.yml`: put the .yarnrc.yml here.
- `.yarn/`: put the .yarn/ here.
- `.env.example`: put the .env.example here.
- `README.md`: put the README.md here.

The real implemenetation should use `camelCase` for the function and variable names in both Contract and Typescript code, do not need to follow the pseudo code style.

### Bot Typescript logic

This is where the bot logic is implemented.

The logic should be in `bot/dloop-reward-compounder/bot-typescript/src/` directory.

The endtrypoint is in `bot/dloop-reward-compounder/bot-typescript/src/runner.ts`

The related contract addresses will be stored in `bot/dloop-reward-compounder/bot-typescript/config/networks/` directory for each network.

Have these files with correct content:

- `Dockerfile` (reference: `ai-promt/dloop-reward-compounder/bot-typescript/bot.Dockerfile`)
- `Makefile`
- `package.json`
- `tsconfig.json`
- `eslint.config.mjs`
- `jest.config.js`

Make sure it follows the Typescript `eslint` setup in `./` repo.

`Makefile` should have the following targets:

- `make lint`
- `make test`
- `make run network=<network>`
- `make docker.build.arm64`
- `make docker.build.amd64`
- `make docker.run network=<network>`

Make sure the Dockerfile has multi-stage build.

Expected structure:

- `src`: put all `.ts` files in this directory.
- `test`: put all jest-based test files here. For external resource (NotificationManager, OdosAPI,...), please mock the externa resource instead of of trying to connect to it.
- `config`: put all per network config files here.
- `Dockerfile`: put the Dockerfile here.
- `Makefile`: put the Makefile here.
- `package.json`: put the package.json here.
- `tsconfig.json`: put the tsconfig.json here.
- `eslint.config.mjs`: put the eslint.config.mjs here.
- `jest.config.js`: put the jest.config.js here.
- `.yarnrc.yml`: put the .yarnrc.yml here.
- `.yarn/`: put the .yarn/ here.
- `.env.example`: put the .env.example here.
- `README.md`: put the README.md here.

For contract addresses, do not put it in the `.env` file and the load it into the config. Instead, put it directly (hardcoded) in the per network config file. For example:

- For `sonic_mainnet`, put all related Sonic mainnet addresses in `bot/dloop-reward-compounder/bot-typescript/config/networks/sonic_mainnet.ts`

- For `sonic_testnet`, put all related Sonic testnet addresses in `bot/dloop-reward-compounder/bot-typescript/config/networks/sonic_testnet.ts`

The real implementation should use `camelCase` for the function and variable names, do not need to follow the pseudo code style.

The repo `bot/dlend-liquidator` is mix of Solidity contract-only repo and Typescript repo. We use this repo as logic reference for the `bot-typescript` sub-repo. But please do not use its Dockerfile and directory structure.

## Solidity contract instructions

### Instruction for flashloan-based reward compounding periphery contract

Read through `ai-promt/dloop-reward-compounder/flashloan-reward-compounding-explanation.md` to understand the bot Solidity contract logic with pseudo code.

This contract implements the flashloan-based reward compounding logic, means anyone can call its method to run the compounding and asset exchanging process. If the exchanged reward (dUSD) is sufficient to repay the flashloan, the transaction will successful. Otherwise, it will revert and caller still have to pay for gas fee.

This contract will be implemented in the sub-repo `bot/dloop-reward-compounder/bot-solidity-contracts/contracts/`.

The deployment script will be in `bot/dloop-reward-compounder/bot-solidity-contracts/deploy/`.

### Instruction for reward quoting helper contract

Read through `ai-promt/dloop-reward-compounder/reward-quoting-implementation.md` to understand the bot Solidity contract logic with pseudo code.

This contract implements the reward quoting logic, means anyone can call its method to get the quote for the reward compounding.

This contract will be implemented in the sub-repo `bot/dloop-reward-compounder/bot-solidity-contracts/contracts/`.

## How does the bot works?

This section describes how the bot's flow works, from Typescript code to call the deployed Solidity contract, and how the bot will notify the result to the admin user.

### 1. Get the quote to estimate the current accurred reward of the DLoopVault

Basically, the bot will call the `RewardQuoteHelper.sol` contract's method to get the quote for the reward compounding.

- Check the implementation plan of this logic in `ai-promt/dloop-reward-compounder/reward-quoting-implementation.md`

The reward value is after applying the `treasuryFeeBps` (this value is in `RewardClaimable.sol`).

The $ value of the exchange assets (in this case, the shares of `DLoop` vault). It is equals to the `dUSD` needed to swap to the collateral token and then deposit these collateral token to DLoopCore to get the shares.

If the reward value (in this case, the reward should be dUSD token) is more than the $ value of the exchange asset after treasury fee + gas fee (in `exchangeThreshold` of `RewardClaimable.sol`), then the bot contract will execute the reward compounding call. Otherwise, skip this time.

### 2. Call the periphery contract to compound the reward

Basically, the bot will call the `RewardCompounderDLendOdos.sol` contract's method to compound the reward.

- Check the implementation plan of this logic in `ai-promt/dloop-reward-compounder/flashloan-reward-compounding-explanation.md`

As the bot is going to call the flashloan-based periphery contracts (`bot/dloop-reward-compounder/bot-solidity-contracts/contracts/`) => there is NO NEED to approve any input token to be spent.

Caller just call the periphery contract's function to compound the reward:

- If it succeeds, but the remaining reward is less than the gas fee, then caller got a loss due to the gas fee.

- If it succeeds, and the remaining reward is more than the gas fee, then caller got a profit = remaining reward - gas fee.

- If it fails, then caller got a loss due to the gas fee.

### 4. Notify the result

When there is a successful compounding or failed compounding, the bot should:

- Print out the result/error.
- Send to Slack channel (similar to `bot/dlend-liquidator/typescript/odos_bot/notification.ts`) to notify the result.

## Test requirements

### Test requirements for the bot-solidity-contracts sub-repo

As Odos is not available on local hardhat network, we need to mock the swap venue.

- Implement `RewardCompounderDLendMock.sol` to mock the `RewardCompounderDLendBase.sol` contract with the mock swap logic. Reference: `contracts/vaults/dloop/periphery/venue/mock/DLoopDepositorMock.sol`
- Implement `RewardQuoteHelperMock.sol` to mock the `RewardQuoteHelperBase.sol` contract with the mock quote logic. Reference: `contracts/vaults/dloop/core/venue/dlend/DLoopCoreMock.sol`

Should test with a mock `DLoopCoreMock` as dloopCore to verify the bot can compoundReward the reward successfully.

- Find reference for `DLoopCoreMock` in `contracts/vaults/dloop/core/venue/mock/DLoopCoreMock.sol` and `test/dloop/DLoopCoreMock`

Make sure the reward quoting logic in `RewardQuoteHelperBase.sol` is working properly via testing with mock DLend venue logic in `RewardQuoteHelperMock.sol`

Make sure the flashloan-based reward compounding logic in `RewardCompounderDLendBase.sol` is working properly via testing with mock Odos venue logic in `RewardCompounderDLendMock.sol`.

### Test requirements for the bot-typescript sub-repo

Make sure the bot flow works properly with mockd contract instance (we do not a real contract instance for testing, just mock it input->output). The goal is to make sure the bot works as expected with the given contract instance's I/O:

- Implement detail unit-test cases for different scenarios:
  - The bot can compoundReward the reward successfully.
  - The bot can not compoundReward the reward due to the insufficient reward.
  - The bot can not compoundReward the reward due to the insufficient collateral.
  - Trials handling cases.
  - Others (you can add more if needed).

Make sure the notification logic is working properly, with mock Slack webhook response.

- Do not need to test against real Slack connection.

## Review requirements

### Review the bot-solidity-contracts sub-repo (contracts, tests and deployment script)

Here are the review requirements:

- Make sure `make lint` are passing.
- Make sure `make test` are passing.
- Make sure it follows the `eslint` and linting setup in `bot/dlend-liquidator/eslint.config.mjs`.
- Make sure the contracts can be compiled with `make compile`
- Make sure we can deploy the contracts with `make deploy.sonic_mainnet` (does not need to run the deployment script, just review and make sure the deployment script and config are correct and ready to run).
- Make sure the swap logic is correct, especially the exactIn and exactOut argument mismatch.


### Review the bot-typescript sub-repo (logic and test)

Here are the review requirements:

- Make sure `make lint` are passing.
- Make sure `make test` are passing.
- Make sure it follows the `eslint` and linting setup in `bot/dlend-liquidator/eslint.config.mjs`.
- Make sure the bot logic flow is correct and working as expected.
- Make sure the test cases are correct and working as expected.
- Make sure the notification logic is working properly, with mock Slack webhook response.

## Hints

### Testing issue solution tricks

- For tests which requires external resource (NotificationManager, OdosAPI,...), please mock the externa resource instead of of trying to connect to it.

- If a test file is failed, and you can try running each test or test group (under a sub `describe` section) to see if each of them are working individually or not, if yes, then you can split the test file into smaller test files, with single-test/sub-test-group per file. That could help to solve the problem.
