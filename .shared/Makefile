# Shared make targets for dTrinity Hardhat projects

.DEFAULT_GOAL := help
SHELL := /bin/bash

YARN ?= yarn

shared_makefile := $(lastword $(MAKEFILE_LIST))
SHARED_ROOT := $(abspath $(dir $(shared_makefile)))
PROJECT_ROOT := $(abspath $(SHARED_ROOT)/..)
TS_NODE := TS_NODE_PROJECT=$(SHARED_ROOT)/tsconfig.json $(YARN) ts-node --project $(SHARED_ROOT)/tsconfig.json

help: ## Show this help menu
	@echo "Usage:"
	@grep -h -E '^[a-zA-Z0-9_.-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

lint: lint.fix lint.solhint ## Run shared lint suite with fixes and Solhint

lint.fix: ## Run Prettier (write) and ESLint with --fix
	@$(TS_NODE) $(SHARED_ROOT)/scripts/linting/run-all.ts --write --eslint-fix

lint.check: ## Run Prettier and ESLint in check mode
	@$(TS_NODE) $(SHARED_ROOT)/scripts/linting/run-all.ts

lint.ci: lint.check ## Alias for CI lint check

lint.prettier: ## Format all supported files with Prettier
	@$(TS_NODE) $(SHARED_ROOT)/scripts/linting/prettier.ts --write

lint.prettier.check: ## Check Prettier formatting without writing changes
	@$(TS_NODE) $(SHARED_ROOT)/scripts/linting/prettier.ts

lint.prettier.solidity: ## Format Solidity sources with Prettier
	@$(TS_NODE) $(SHARED_ROOT)/scripts/linting/prettier.ts --write --pattern 'contracts/**/*.sol'

lint.prettier.solidity.check: ## Check Solidity formatting without writing changes
	@$(TS_NODE) $(SHARED_ROOT)/scripts/linting/prettier.ts --pattern 'contracts/**/*.sol'

lint.eslint: ## Run ESLint with --fix using shared defaults
	@$(TS_NODE) $(SHARED_ROOT)/scripts/linting/eslint.ts --fix

lint.eslint.check: ## Run ESLint in check mode using shared defaults
	@$(TS_NODE) $(SHARED_ROOT)/scripts/linting/eslint.ts

lint.solhint: ## Run Solhint with shared configuration
	@$(TS_NODE) $(SHARED_ROOT)/scripts/analysis/solhint.ts

lint.solidity: lint.prettier.solidity lint.solhint ## Format Solidity and run Solhint

lint.solidity.check: lint.prettier.solidity.check lint.solhint ## Check Solidity formatting and Solhint rules

lint.typescript: lint.eslint ## Run TypeScript/JavaScript ESLint with fixes

lint.typescript.check: lint.eslint.check ## Run TypeScript/JavaScript ESLint in check mode

slither: ## Run Slither using shared workflow defaults
	@$(TS_NODE) $(SHARED_ROOT)/scripts/analysis/slither.ts default

slither.check: ## Run Slither in strict/fail-fast mode
	@$(TS_NODE) $(SHARED_ROOT)/scripts/analysis/slither.ts check

slither.focused: ## Run Slither on a specific contract (make slither.focused contract=path/to/Contract.sol)
	@if [ "$(contract)" = "" ]; then \
		echo "Must provide 'contract' argument. Example: make slither.focused contract=contracts/MyContract.sol"; \
		exit 1; \
	fi
	@$(TS_NODE) $(SHARED_ROOT)/scripts/analysis/slither.ts focused --contract "$(contract)"

slither.ensure: ## Ensure Slither is installed via the shared helper
	@$(TS_NODE) $(SHARED_ROOT)/scripts/analysis/slither.ts --ensure-only

analyze.shared: ## Run the shared static analysis suite (Slither + Mythril, etc.)
	@$(TS_NODE) $(SHARED_ROOT)/scripts/analysis/run-all.ts

guardrails: ## Run shared guardrail checks (install, lint, dependency invariants)
	@$(TS_NODE) $(SHARED_ROOT)/scripts/guardrails/check.ts

shared.update: ## Refresh the vendored .shared subtree to the latest main
	@bash $(SHARED_ROOT)/scripts/subtree/update.sh

shared.setup: ## Run shared project setup helpers
	@$(TS_NODE) $(SHARED_ROOT)/scripts/setup.ts

shared.sanity.deploy-ids: ## Scan for hardcoded deploy identifiers
	@$(TS_NODE) $(SHARED_ROOT)/scripts/deployments/find-hardcoded-deploy-ids.ts

shared.sanity.deploy-clean: ## Clean deployments for provided keywords (make shared.sanity.deploy-clean deployment_keywords=A,B network=network)
	@if [ "$(deployment_keywords)" = "" ]; then \
		echo "Must provide 'deployment_keywords' argument."; \
		exit 1; \
	fi
	@if [ "$(network)" = "" ]; then \
		echo "Must provide 'network' argument."; \
		exit 1; \
	fi
	@$(TS_NODE) $(SHARED_ROOT)/scripts/deployments/clean-deployments.ts --keywords "$(deployment_keywords)" --network "$(network)"

shared.sanity.deploy-addresses: ## Print deployment addresses for provided keywords (make ... deployment_keywords=A,B network=network)
	@if [ "$(deployment_keywords)" = "" ]; then \
		echo "Must provide 'deployment_keywords' argument."; \
		exit 1; \
	fi
	@if [ "$(network)" = "" ]; then \
		echo "Must provide 'network' argument."; \
		exit 1; \
	fi
	@$(TS_NODE) $(SHARED_ROOT)/scripts/deployments/print-contract-addresses.ts --keywords "$(deployment_keywords)" --network "$(network)"

shared.sanity.oracle-addresses: ## Print oracle source addresses for provided keywords (make ... deployment_keywords=A,B network=network)
	@if [ "$(deployment_keywords)" = "" ]; then \
		echo "Must provide 'deployment_keywords' argument."; \
		exit 1; \
	fi
	@if [ "$(network)" = "" ]; then \
		echo "Must provide 'network' argument."; \
		exit 1; \
	fi
	@$(TS_NODE) $(SHARED_ROOT)/scripts/deployments/print-oracle-sources.ts --keywords "$(deployment_keywords)" --network "$(network)"

shared.metrics.nsloc: ## Generate Solidity non-comment SLOC metrics
	@$(TS_NODE) $(SHARED_ROOT)/scripts/deployments/nsloc.ts

roles.scan: ## Scan contracts for role assignments and ownership (make roles.scan network=network deployer=address governance=address)
	@if [ "$(network)" = "" ]; then \
		echo "Must provide 'network' argument."; \
		exit 1; \
	fi
	@if [ "$(deployer)" = "" ]; then \
		echo "Must provide 'deployer' argument."; \
		exit 1; \
	fi
	@if [ "$(governance)" = "" ]; then \
		echo "Must provide 'governance' argument."; \
		exit 1; \
	fi
	@$(TS_NODE) $(SHARED_ROOT)/scripts/roles/scan-roles.ts --network "$(network)" --deployer "$(deployer)" --governance "$(governance)"

roles.transfer: ## Transfer roles from deployer to governance (make roles.transfer network=network deployer=address governance=address [--yes])
	@if [ "$(network)" = "" ]; then \
		echo "Must provide 'network' argument."; \
		exit 1; \
	fi
	@if [ "$(deployer)" = "" ]; then \
		echo "Must provide 'deployer' argument."; \
		exit 1; \
	fi
	@if [ "$(governance)" = "" ]; then \
		echo "Must provide 'governance' argument."; \
		exit 1; \
	fi
	@$(TS_NODE) $(SHARED_ROOT)/scripts/roles/transfer-roles.ts --network "$(network)" --deployer "$(deployer)" --governance "$(governance)" $(if $(yes),--yes,)

roles.revoke: ## Revoke deployer roles via Safe batch (make roles.revoke network=network deployer=address governance=address safe_address=address chain_id=number)
	@if [ "$(network)" = "" ]; then \
		echo "Must provide 'network' argument."; \
		exit 1; \
	fi
	@if [ "$(deployer)" = "" ]; then \
		echo "Must provide 'deployer' argument."; \
		exit 1; \
	fi
	@if [ "$(governance)" = "" ]; then \
		echo "Must provide 'governance' argument."; \
		exit 1; \
	fi
	@if [ "$(safe_address)" = "" ]; then \
		echo "Must provide 'safe_address' argument."; \
		exit 1; \
	fi
	@if [ "$(chain_id)" = "" ]; then \
		echo "Must provide 'chain_id' argument."; \
		exit 1; \
	fi
	@$(TS_NODE) $(SHARED_ROOT)/scripts/roles/revoke-roles.ts --network "$(network)" --deployer "$(deployer)" --governance "$(governance)" --safe-address "$(safe_address)" --chain-id "$(chain_id)"

.PHONY: \
	help \
	lint lint.fix lint.check lint.ci \
	lint.prettier lint.prettier.check lint.prettier.solidity lint.prettier.solidity.check \
	lint.eslint lint.eslint.check lint.solhint \
	lint.solidity lint.solidity.check lint.typescript lint.typescript.check \
	slither slither.check slither.focused slither.ensure \
	analyze.shared guardrails shared.update shared.setup \
	shared.sanity.deploy-ids shared.sanity.deploy-clean shared.sanity.deploy-addresses shared.sanity.oracle-addresses \
	shared.metrics.nsloc \
	roles.scan roles.transfer roles.revoke
