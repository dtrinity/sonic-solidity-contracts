################
## Deployment ##
################

deploy.sonic_testnet:
	@yarn hardhat deploy --network sonic_testnet

deploy.sonic_mainnet:
	@yarn hardhat deploy --network sonic_mainnet 

#############
## Linting ##
#############

lint: lint.solidity lint.typescript ## Run the linters

lint.ci: ## Lint but don't fix
	@yarn prettier --check --plugin=prettier-plugin-solidity 'contracts/**/*.sol'
	@yarn solhint "contracts/**/*.sol"
	@yarn eslint .

lint.solidity: ## Run the solidity linter
	@yarn prettier --write --plugin=prettier-plugin-solidity 'contracts/**/*.sol'
	@yarn solhint "contracts/**/*.sol"

lint.typescript: ## Run the typescript linter
	@yarn eslint . --fix

########################
## Running the bot ##
########################

run.%:
	@yarn hardhat run \
		--network $* \
		typescript/odos_bot/run.ts

run.sonic_mainnet:
run.sonic_testnet:
