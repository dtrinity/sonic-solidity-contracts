# Make 'help' the default target
.DEFAULT_GOAL := help

help: ## Show this help menu
	@echo "Usage:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

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

#############
## Testing ##
#############

test: test.hardhat test.typescript ## Run all tests

test.ci: test.hardhat test.typescript.unit ## Run all deterministic tests in CI mode

test.typescript: test.typescript.unit test.typescript.integ ## Run the typescript tests

test.typescript.unit: ## Run the typescript unit tests
	@yarn jest --detectOpenHandles --testPathPattern=test\\.unit\\.ts --passWithNoTests

test.typescript.integ: ## Run the typescript integration tests
	@yarn jest --detectOpenHandles --testPathPattern=test\\.integ\\.ts --passWithNoTests

test.hardhat: ## Run the hardhat tests
	@yarn hardhat test

#############
## Certora ##
#############

certora.install: ## Install Certora prover
	@virtualenv certora
	@certora/bin/pip install certora-cli
	@echo "\n\n"
	@echo "REMINDER: Add CERTORAKEY=<your-certora-key> to .env"
	@echo "Also consider installing the language plugin: https://marketplace.visualstudio.com/items?itemName=Certora.evmspec-lsp"

certora.run: ## Run Certora prover
	@if [ ! -d "certora" ]; then \
		echo "Certora environment not found. Run 'make certora.install' first."; \
		exit 1; \
	fi; \
	. certora/bin/activate; \
	if [ -z "$(contract)" ]; then \
		echo "Error: contract path not provided. Usage: make certora.run contract=path/to/contract.sol"; \
		exit 1; \
	fi; \
	contract_name=$$(basename $(contract) .sol); \
	spec_file=$$(dirname $(contract))/$${contract_name}.spec; \
	if [ ! -f "$${spec_file}" ]; then \
		echo "Error: Spec file not found at $${spec_file}"; \
		exit 1; \
	fi; \
	certoraRun $(contract):$${contract_name} \
		--verify $${contract_name}:$${spec_file} \
		--solc solc \
		--optimistic_loop || { echo "Certora verification failed"; exit 1; }

certora.verify: ## Verify a specific rule in a contract
	@if [ ! -d "certora" ]; then \
		echo "Certora environment not found. Run 'make certora.install' first."; \
		exit 1; \
	fi; \
	. certora/bin/activate; \
	if [ -z "$(contract)" ] || [ -z "$(rule)" ]; then \
		echo "Error: contract and rule must be provided. Usage: make certora.verify contract=path/to/contract.sol rule=ruleName"; \
		exit 1; \
	fi; \
	contract_name=$$(basename $(contract) .sol); \
	spec_file=$$(dirname $(contract))/$${contract_name}.spec; \
	certoraRun $(contract):$${contract_name} \
		--verify $${contract_name}:$${spec_file} \
		--solc solc \
		--optimistic_loop \
		--rule $(rule)

certora.shell: ## Activate Certora virtual environment in current shell
	@if [ ! -d "certora" ]; then \
		echo "Certora environment not found. Run 'make certora.install' first."; \
		exit 1; \
	fi; \
	echo "Activating Certora virtual environment..."; \
	echo "Run 'deactivate' to exit when done."; \
	. certora/bin/activate; \
	PS1="(certora) $$PS1"; \
	/bin/bash --norc -i

################
## Deployment ##
################

deploy: ## Deploy the contracts
	@yarn hardhat deploy

####################
## Block explorer ##
####################

explorer.verify.sonic_testnet:
	@echo "Verifying contracts on sonic testnet..."
	@yarn hardhat --network sonic_testnet etherscan-verify --api-key 4EJCRRD3JKIE6TKF6ME7AKVYWFEJI79A26 --api-url https://api-testnet.sonicscan.org

explorer.verify.sonic_mainnet:
	@echo "Verifying contracts on sonic mainnet..."
	@yarn hardhat --network sonic_mainnet etherscan-verify --api-key 4EJCRRD3JKIE6TKF6ME7AKVYWFEJI79A26 --api-url https://api.sonicscan.org

##############
## Building ##
##############

compile: ## Compile the contracts
	@yarn hardhat compile

clean: ## When renaming directories or files, run this to clean up
	@rm -rf typechain-types
	@rm -rf artifacts
	@rm -rf cache
	@echo "Cleaned solidity cache and artifacts. Remember to recompile."

.PHONY: help compile test deploy clean
