Goal: Provide deploy scripts and per-network config for Solidity contracts.

Deliverables
- `deploy/00_deploy_reward_quote_helper.ts`
- `deploy/01_deploy_reward_compounder_odos.ts`
- `config/networks/sonic_mainnet.json`, `config/networks/sonic_testnet.json`

Behavior
- Read addresses/constants from the JSON files (not env), e.g. CORE, dUSD, pool, rewardsController, addressProvider, flash lender, odos router.
- Tag deployments and export artifacts.
- Include verification step guarded behind env flags.

Makefile targets
- `make deploy-contracts.sonic_mainnet`
- `make deploy-contracts.sonic_testnet`
Map to `hardhat run --network <name> deploy/*.ts`.

Acceptance
- Dry-run deploy scripts compile and resolve config.
- Network files contain placeholders and shape validation.

Quick check
- Add a `--print` mode in scripts to log config without sending txs.

