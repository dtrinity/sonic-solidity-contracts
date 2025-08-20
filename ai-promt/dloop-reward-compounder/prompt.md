I want to implement a bot to perform reward compounding calls on DLoopCoreDLend, via flashloan-based periphery contract.

- This periphery is not existing yet and we need to implement and deploy it.

Please generate an implementation plan and test-plan (with mock test cases) for the bot, based on the following requirements. Then, do a review on the gennerated plans and make sure it is correct and complete. Write down the plan into `ai-plan/dloop-reward-compounder/plan.md`

## Overview

- The bot repo directory is in `bot/dloop-reward-compounder`
- The bot should follow the same structure as the DLend liquidator bot in `bot/dlend-liquidator`. Does not need to be 100% the same, but should be similar in style, code organization, contract implementation and deployment, etc.
  - A good reference is the `/Users/dinosaurchi/Desktop/Project/stably-prime/trinity/dloop-rebalancer` bot implementation. However, the rebalancer bot's repo does not have a flashloan-based periphery contract implementation and deployment, thus it's a bit different.
- The bot repo should be independent to `./` repo, means if I move the `bot/dloop-reward-compounder` out of `./`, it still work fine without any installation, dependencies issue.
- We need to implement a new flashloan-based periphery contract. Examples:
  - `DLoopIncreaseLeverageOdos.sol` and `DLoopDecreaseLeverageOdos.sol` in `contracts/vaults/dloop/periphery/venue/odos/`
  - `bot/dlend-liquidator/contracts/aave-v3/FlashMintLiquidatorAaveBorrowRepayOdos.sol`

## Prepare the periphery contract

Read through `ai-promt/dloop-reward-compounder/flashloan-reward-compounding-explanation.md` to understand the bot logic with pseudo code.

This contract implements the flashloan-based reward compounding logic, means anyone can call its method to run the compounding and asset exchanging process. If the exchanged reward (dUSD) is sufficient to repay the flashloan, the transaction will successful. Otherwise, it will revert and caller still have to pay for gas fee.

This contract will be implemented in `bot/dloop-reward-compounder/contracts/`.

## How does the bot works?

### 1. Get the quote to estimate the current accurred reward of the DLoopVault

Check the implementation plan of this logic in `ai-promt/dloop-reward-compounder/reward-quoting-implementation.md`

The reward value be after applying the `treasuryFeeBps` (this value is in `RewardClaimable.sol`).

The $ value of the exchange assets (in this case, the shares of `DLoop` vault). It is equals to the `dUSD` needed to swap to the collateral token and then deposit these collateral token to DLoopCore to get the shares.

If the reward value (in this case, the reward should be dUSD token) is more than the $ value of the exchange asset (in `exchangeThreshold` of `RewardClaimable.sol`), then the bot contract will execute the reward compounding call. Otherwise, skip this time.

### 2. Call the periphery contract to compound the reward

As the bot is going to call the flashloan-based periphery contracts (`bot/dloop-reward-compounder/contracts/`), there is NO NEED to approve any input token to be spent.

### 4. Notify the result

When there is a successful compounding or failed compounding, the bot should:

- Print out the result/error.
- Send to Slack channel (similar to `bot/dlend-liquidator/typescript/odos_bot/notification.ts`) to notify the result.

## Source code structure

Please read and write the repo structure of `bot/dlend-liquidator`, then based on that to generate the repo structure for `bot/dloop-reward-compounder`. Make sure it meets the following critical:

- For missing contract interfaces, just copy the interface from `./` repo.
- The core contract address will be stored in the config (similar to `bot/dlend-liquidator/config/`).
- Make sure the docker image can be built with `make docker.build` (similar to `bot/dlend-liquidator/Dockerfile` and `bot/dlend-liquidator/Makefile`).

The contract logic should be abstracted to `Base` and venue-specific contracts:

- Abstract base: `RewardCompounderDLendBase.sol` (reference `bot/dlend-liquidator/contracts/aave-v3/FlashMintLiquidatorAaveBorrowRepayBase.sol`)
- Venue-specific: `RewardCompounderDLendOdos.sol` (Odos is the swap venue, reference `bot/dlend-liquidator/contracts/aave-v3/FlashMintLiquidatorAaveBorrowRepayOdos.sol`)

Pleae strictly follow the linting setup with `eslint` in `/Users/dinosaurchi/Desktop/Project/stably-prime/trinity/dloop-rebalancer`.

## Test requirements

- Should have a full-flow test of running the bot with mock DLoopCoreMock, and verify the bot can compoundReward the reward successfully.

## Review requirements

Follow the instruction, criteria in all `.md` file in `ai-review/`. Here are some additional expectation:

- Make sure the contracts can be compiled with `make compile`
- Make sure we can deploy the contracts with `make deploy.sonic_mainnet` (does not need to run the deployment script, just review and make sure the deployment script is correct and ready to run).
- Make sure the swap logic is correct, especially the exactIn and exactOut argument mismatch.
- Make sure it follows the `eslint` and linting setup in `/Users/dinosaurchi/Desktop/Project/stably-prime/trinity/dloop-rebalancer`.
- Make sure `make lint` are passing.
- Make sure `make test` are passing.

## Hints

### Testing issue

- For tests which requires external resource (NotificationManager, OdosAPI,...), please mock the externa resource instead of of trying to connect to it.

- If a test file is failed, and you can try running each test or test group (under a sub `describe` section) to see if each of them are working individually or not, if yes, then you can split the test file into smaller test files, with single-test/sub-test-group per file. That could help to solve the problem.
