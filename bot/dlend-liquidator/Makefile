-include ./.env

IMAGE_NAME:=liquidator-bot-sonic

######################
## Hardhat commands ##
######################

compile:
	@echo "Compiling..."
	@yarn hardhat compile --show-stack-traces

#########################
## Contract deployment ##
#########################

deploy.contracts.sonic_testnet:
	@yarn hardhat deploy --network sonic_testnet

deploy.contracts.sonic_mainnet:
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

#####################
## Running the bot ##
#####################

run.%:
	@yarn hardhat run \
		--network $* \
		typescript/odos_bot/run.ts

run.sonic_mainnet:
run.sonic_testnet:

####################
## Remote helpers ##
####################

remote.ssh:
	@if [ "${HOST_SSH_KEY_PATH}" = "" ]; then \
		echo "HOST_SSH_KEY_PATH is not set in .env"; \
		exit 1; \
	fi
	@if [ "${HOST_NAME}" = "" ]; then \
		echo "HOST_NAME is not set in .env"; \
		exit 1; \
	fi
	@echo "SSH into remote host..."
	@ssh -i ${HOST_SSH_KEY_PATH} ubuntu@${HOST_NAME}

remote.upload:
	@if [ "$(file_path)" = "" ]; then \
		echo -e "Must provide file_path argument"; \
		exit 1; \
	fi
	@if [ "$(dest_path)" = "" ]; then \
		echo -e "Must provide dest_path argument"; \
		exit 1; \
	fi
	@if [ "$(HOST_NAME)" = "" ]; then \
		echo -e "Must provide HOST_NAME argument"; \
		exit 1; \
	fi
	@if [ "$(HOST_SSH_KEY_PATH)" = "" ]; then \
		echo -e "Must provide HOST_SSH_KEY_PATH argument"; \
		exit 1; \
	fi
	@$(eval host_dest_path="ubuntu@${HOST_NAME}:$(dest_path)")
	@echo "Uploading file $(file_path) to $(host_dest_path)"
	@rsync -h -P -e "ssh -i ${HOST_SSH_KEY_PATH}" -a $(file_path) $(host_dest_path)

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

docker.build.amd64: platform:=linux/amd64
docker.build.amd64: docker.build

docker.run: container_name=${IMAGE_NAME}-$(network)-$(dex)
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
	@docker rm -f ${container_name} || true
	@echo "Running liquidator bot docker image..."
	@docker run \
		-d \
		-v $(shell pwd)/.env:/usr/src/.env:ro \
		-v $(shell pwd)/state:/usr/src/state \
		--memory 768m \
		--restart unless-stopped \
		--platform $(platform) \
		--name ${container_name} \
		${IMAGE_NAME}-$(platform):latest $(network) $(dex)

docker.run.odos.mainnet.arm64: network=sonic_mainnet
docker.run.odos.mainnet.arm64: dex=odos
docker.run.odos.mainnet.arm64: platform=linux/arm64
docker.run.odos.mainnet.arm64: docker.run

docker.run.odos.testnet.arm64: network=sonic_testnet
docker.run.odos.testnet.arm64: dex=odos
docker.run.odos.testnet.arm64: platform=linux/arm64
docker.run.odos.testnet.arm64: docker.run

docker.dump-image:
	@if [ "$(output_file_name)" = "" ]; then \
		echo "Must provide 'output_file_name' argument"; \
		exit 1; \
	fi
	@echo "Exporting docker image to ./.tmp/$(output_file_name).tar..."
	@mkdir -p .tmp
	@docker save ${IMAGE_NAME}:latest > .tmp/$(output_file_name).tar

docker.load-image:
	@if [ "$(image_path)" = "" ]; then \
		echo "Must provide 'image_path' argument"; \
		exit 1; \
	fi
	@echo "Loading docker image $(image_path) on host $(HOST_NAME)"
	@ssh -i $(HOST_SSH_KEY_PATH) ubuntu@$(HOST_NAME) \
		"docker load -i $(image_path) && rm -r $(image_path)"

####################
## Bot deployment ##
####################

deploy-remote.bot: container_name=${IMAGE_NAME}-$(network)-$(dex)
deploy-remote.bot: state_dir_name=$(network)-$(dex)
deploy-remote.bot:
	@if [ "$(network)" = "" ]; then \
		echo "Must provide 'network' argument"; \
		exit 1; \
	fi
	@if [ "$(dex)" = "" ]; then \
		echo "Must provide 'dex' argument"; \
		exit 1; \
	fi
	@make docker.build.amd64 && \
	make docker.dump-image output_file_name=${IMAGE_NAME}-amd64 && \
	make remote.upload \
		file_path=.tmp/${IMAGE_NAME}-amd64.tar \
		dest_path=/home/ubuntu/${IMAGE_NAME}-amd64.tar && \
	make remote.upload \
		file_path=./.env \
		dest_path=/home/ubuntu/.env && \
	make docker.load-image \
		image_path=/home/ubuntu/${IMAGE_NAME}-amd64.tar && \
	ssh -i $(HOST_SSH_KEY_PATH) ubuntu@$(HOST_NAME) \
		"mkdir -p /home/ubuntu/state/$(state_dir_name)" && \
	(ssh -i $(HOST_SSH_KEY_PATH) ubuntu@$(HOST_NAME) \
		"docker rm -f ${container_name} || true") && \
	ssh -i $(HOST_SSH_KEY_PATH) ubuntu@$(HOST_NAME) \
		"docker run \
			-d \
			-v /home/ubuntu/.env:/usr/src/.env:ro \
			-v /home/ubuntu/state/$(state_dir_name):/usr/src/state \
			--memory 512m \
			--restart unless-stopped \
			--platform $(platform) \
			--name ${container_name} \
			${IMAGE_NAME}:latest $(network) $(dex)"
	@ssh -i $(HOST_SSH_KEY_PATH) ubuntu@$(HOST_NAME) \
		"docker image prune -f"

deploy-remote.bot.sonic_mainnet: network=sonic_mainnet
deploy-remote.bot.sonic_mainnet: dex=odos
deploy-remote.bot.sonic_mainnet: platform=linux/amd64
deploy-remote.bot.sonic_mainnet: deploy-remote.bot
