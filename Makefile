include .shared/Makefile

##############
## Testing  ##
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
## Static Analysis  ##
######################

mythril: ## Run Mythril security analysis on all contracts
	@echo "Running Mythril security analysis on all contracts..."
	@./scripts/mythril/run_mythril.py --max-workers 8 --timeout 300 --max-depth 18
	@echo "Generating Mythril analysis summary..."
	@./scripts/mythril/generate_summary.py

mythril.focused: ## Run Mythril on specific contract (usage: make mythril.focused contract=ContractName)
	@if [ "$(contract)" = "" ]; then \
		echo "Must provide 'contract' argument. Example: 'make mythril.focused contract=contracts/dlend/core/protocol/pool/Pool.sol'"; \
		exit 1; \
	fi
	@echo "Running Mythril analysis on $(contract)..."
	@./scripts/mythril/run_mythril.py --contract "$(contract)" --timeout 300 -t 10 --max-depth 18 --call-depth-limit 8

mythril.summary: ## Generate summary from existing Mythril results
	@echo "Generating Mythril analysis summary..."
	@./scripts/mythril/generate_summary.py

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

explorer.verify.sonic_testnet: ## Verify contracts on sonic testnet
	@echo "Verifying contracts on sonic testnet..."
	@yarn hardhat --network sonic_testnet etherscan-verify --api-key 4EJCRRD3JKIE6TKF6ME7AKVYWFEJI79A26 --api-url https://api-testnet.sonicscan.org

explorer.verify.sonic_mainnet: ## Verify contracts on sonic mainnet
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

.PHONY: \
	test test.ci test.typescript test.typescript.unit test.typescript.integ test.hardhat \
	mythril mythril.focused mythril.summary audit \
	deploy clean-deployments explorer.verify.sonic_testnet explorer.verify.sonic_mainnet \
	compile clean
