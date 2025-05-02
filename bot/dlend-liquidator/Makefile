-include ./.env

IMAGE_NAME:=liquidator-bot

#######################
## Hardhat commands ##
#######################

compile:
	@echo "Compiling..."
	@yarn hardhat compile --show-stack-traces

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

############
## Docker ##
############

docker.build: compile # Need pre-compilation as we need to copy the artifacts
docker.build:
	@if [ "$(platform)" = "" ]; then \
		echo "Must provide 'platform' argument"; \
		exit 1; \
	fi
	@echo "Building liquidator bot docker image..."
	@docker build \
		--platform $(platform) \
		--pull \
		--build-arg HOST_PWD=$(shell pwd) \
		-f ./Dockerfile \
		-t ${IMAGE_NAME}:latest \
		-t ${IMAGE_NAME}-$(platform):latest \
		.

docker.build.arm64: platform:=linux/arm64
docker.build.arm64: docker.build

docker.run:
	@if [ "$(network)" = "" ]; then \
		echo "Must provide 'network' argument"; \
		exit 1; \
	fi	
	@if [ "$(dex)" = "" ]; then \
		echo "Must provide 'dex' argument"; \
		exit 1; \
	fi
	@if [ "$(platform)" = "" ]; then \
		echo "Must provide 'platform' argument"; \
		exit 1; \
	fi
	@mkdir -p ./state
	@echo "Running liquidator bot docker image..."
	@docker run \
		-d \
		-v $(shell pwd)/.env:/usr/src/.env:ro \
		-v $(shell pwd)/state:/usr/src/state \
		--memory 768m \
		--restart unless-stopped \
		--platform $(platform) \
		--name ${IMAGE_NAME}-$(network)-$(dex) \
		${IMAGE_NAME}-$(platform):latest $(network) $(dex)

docker.run.odos.mainnet.arm64: network=sonic_mainnet
docker.run.odos.mainnet.arm64: dex=odos
docker.run.odos.mainnet.arm64: platform=linux/arm64
docker.run.odos.mainnet.arm64: docker.run

docker.run.odos.testnet.arm64: network=sonic_testnet
docker.run.odos.testnet.arm64: dex=odos
docker.run.odos.testnet.arm64: platform=linux/arm64
docker.run.odos.testnet.arm64: docker.run