Title: DLoop Reward Compounder — Implementation & Test Plan (Cursor GPT‑5)

Purpose: Build a two-subrepo bot (Solidity periphery + TypeScript runner) that compounds DLoopCoreDLend rewards via flashloan/flashmint. Deliver a clean, reproducible scaffold with tests, linting, Makefiles, and Docker.

How To Use This Plan
- Follow steps in order. Each step is focused and verifiable.
- Keep the two sub-repos independent of the root repo; copy only patterns/configs needed.
- After each step, run the listed quick checks before proceeding.
- Do not connect to external services in tests; mock Odos/aggregator and Slack.

Repo Targets
- Solidity subrepo: `bot/dloop-reward-compounder/bot-solidity-contracts` (Hardhat-based).
- TypeScript subrepo: `bot/dloop-reward-compounder/bot-typescript` (yarn + ts-node + jest + eslint + Docker).

Execution Order (high level)
1) Scaffold folders and init git
2) Solidity repo setup (tooling + config)
3) Implement flashloan periphery + quote helper
4) Hardhat tests + deploy scripts + network configs
5) TypeScript repo setup (tooling + config)
6) Bot logic: quoting, decisioning, compounding call
7) Notifications + logging + error handling
8) Jest tests with mocks
9) Docker + Makefiles + readmes
10) Final review and smoke commands

Quick Validation Commands (run per subrepo)
- Solidity: `make compile`, `make lint`, `make test`
- TypeScript: `make lint`, `make test`, `make run network=sonic_testnet`

Notes
- Use camelCase for all identifiers.
- Share structure with the existing root repo patterns, but no cross-repo dependencies.
- Address constants go into network config files, not `.env`.
