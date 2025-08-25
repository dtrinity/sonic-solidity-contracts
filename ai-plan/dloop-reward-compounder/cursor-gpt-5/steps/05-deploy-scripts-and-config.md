Goal: Add deploy scripts and per-network configs for the Solidity subrepo.

Deliverables
- `deploy/` scripts to deploy:
  - `RewardCompounderDLendOdos`
  - `RewardQuoteHelperDLend`
- `config/networks/sonic_mainnet.ts` and `sonic_testnet.ts` with addresses.
- `Makefile` targets: `deploy-contracts.sonic_mainnet`, `deploy-contracts.sonic_testnet`.

Actions
- Mirror style from root `deploy/` scripts, but keep local and minimal.
- Read RPC and keys from `.env` in subrepo.
- Document required env vars in `.env.example`.

Acceptance
- Scripts compile and dry-run on a fork (no real send during review).
