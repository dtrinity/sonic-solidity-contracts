# Make 'help' the default target
.DEFAULT_GOAL := help

help: ## Show this help menu
	@echo "Usage:"
	@grep -E '^[a-zA-Z_.-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

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

##############
## Testing ##
##############

test: test.hardhat test.typescript ## Run all tests

test.ci: test.hardhat test.typescript.unit ## Run all deterministic tests in CI mode

test.typescript: test.typescript.unit test.typescript.integ ## Run the typescript tests

test.typescript.unit: ## Run the typescript unit tests
	@yarn jest --detectOpenHandles --testPathPattern=test\\.unit\\.ts --passWithNoTests

test.typescript.integ: ## Run the typescript integration tests
	@yarn jest --detectOpenHandles --testPathPattern=test\\.integ\\.ts --passWithNoTests

test.hardhat: ## Run the hardhat tests
	@yarn hardhat test

######################
## Static Analysis ##
######################

slither: ## Run Slither static analysis on all contracts with summaries and loc
	@echo "Running Slither static analysis..."
	@mkdir -p reports/slither
	@slither . --config-file slither.config.json \
		--print human-summary \
		--print contract-summary \
		--print loc

slither.check: ## Run Slither with fail-on-high severity with summaries and loc
	@echo "Running Slither with strict checks..."
	@mkdir -p reports/slither
	@slither . --config-file slither.config.json --fail-high \
		--print human-summary \
		--print contract-summary \
		--print loc

slither.focused: ## Run Slither on specific contract with summaries and loc (usage: make slither.focused contract=ContractName)
	@if [ "$(contract)" = "" ]; then \
		echo "Must provide 'contract' argument. Example: 'make slither.focused contract=contracts/dlend/core/protocol/pool/Pool.sol'"; \
		exit 1; \
	fi
	@echo "Running Slither on $(contract)..."
	@mkdir -p reports/slither
	@slither $(contract) --config-file slither.config.json \
		--print human-summary \
		--print contract-summary \
		--print loc

slither.all: ## Run Slither on all contracts and save outputs to files
	@echo "Running Slither test analysis on all contracts..."
	@mkdir -p reports/slither
	@echo "Running human-summary..."
	@slither . --config-file slither.config.json \
		--print human-summary \
		--disable-color > reports/slither/human-summary.txt 2>&1 || true
	@echo "Running contract-summary..."
	@slither . --config-file slither.config.json \
		--print contract-summary \
		--disable-color > reports/slither/contract-summary.txt 2>&1 || true
	@echo "Running loc..."
	@slither . --config-file slither.config.json \
		--print loc \
		--disable-color > reports/slither/loc.txt 2>&1 || true
	@echo "Results saved to reports/slither/"

mythril: ## Run Mythril security analysis on all contracts
	@echo "Running Mythril security analysis on all contracts..."
	@echo "Compiling contracts first..."
	@yarn hardhat compile > /dev/null 2>&1
	@mkdir -p reports/mythril
	@find contracts -name "*.sol" -not -path "*/mocks/*" -not -path "*/testing/*" -not -path "*/dependencies/*" | while read contract; do \
		echo "Analyzing $$contract..."; \
		myth analyze "$$contract" --execution-timeout 120 --solc-json artifacts/build-info/*.json -o json > "reports/mythril/$$(basename $$contract .sol).json" 2>&1; \
	done
	@echo "Mythril analysis completed. Reports saved in reports/mythril/"

mythril.focused: ## Run Mythril on specific contract (usage: make mythril.focused contract=ContractName)
	@if [ "$(contract)" = "" ]; then \
		echo "Must provide 'contract' argument. Example: 'make mythril.focused contract=contracts/dlend/core/protocol/pool/Pool.sol'"; \
		exit 1; \
	fi
	@echo "Running Mythril analysis on $(contract)..."
	@echo "Compiling contracts first..."
	@yarn hardhat compile > /dev/null 2>&1
	@mkdir -p reports/mythril
	@myth analyze "$(contract)" --execution-timeout 300 -t 5 --solc-args "--allow-paths .,node_modules" | tee "reports/mythril/$$(basename $(contract) .sol)_detailed.txt"

mythril.deep: ## Run deep Mythril analysis with extended parameters
	@if [ "$(contract)" = "" ]; then \
		echo "Must provide 'contract' argument. Example: 'make mythril.deep contract=contracts/dlend/core/protocol/pool/Pool.sol'"; \
		exit 1; \
	fi
	@echo "Running deep Mythril analysis on $(contract)..."
	@echo "Compiling contracts first..."
	@yarn hardhat compile > /dev/null 2>&1
	@mkdir -p reports/mythril
	@myth analyze "$(contract)" --execution-timeout 600 -t 10 --max-depth 20 --call-depth-limit 8 --solc-json artifacts/build-info/*.json | tee "reports/mythril/$$(basename $(contract) .sol)_deep.txt"

audit: slither mythril ## Run full security analysis (Slither + full Mythril)
	@echo "Full security analysis completed!"

################
## Deployment ##
################

deploy: ## Deploy the contracts
	@yarn hardhat deploy

clean-deployments: ## Clean the deployments for a given network which matches at least one keyword in the deployment_keywords
	@if [ "$(network)" = "" ]; then \
		echo "Must provide 'network' argument"; \
		exit 1; \
	fi
	@if [ "$(deployment_keywords)" = "" ]; then \
		echo "Must provide 'deployment_keywords' argument. Example: 'deployment_keywords=ContractA,ContractB,PrefixC,PostfixD'"; \
		exit 1; \
	fi
	@echo "Resetting deployments for $(network)"
	@./scripts/deployment/clean-deployments.sh $(deployment_keywords) $(network)

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

.PHONY: help compile test deploy clean slither slither.check slither.focused slither.summary slither.test slither.clean slither.view slither.convert slither.html slither.markdown slither.csv slither.all-formats mythril mythril.focused mythril.quick mythril.deep mythril.dlend mythril.vaults mythril.list-detectors mythril.version mythril.test mythril.clean security security.full

