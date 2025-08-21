.DEFAULT_GOAL := help

help:
	@echo "Targets: compile, test, lint, docker.build, deploy.sonic_mainnet, deploy.sonic_testnet"

compile:
	@yarn hardhat compile

test:
	@yarn hardhat test

lint:
	@yarn eslint . --fix || true

docker.build: compile
	@docker build -t dloop-reward-compounder .

deploy.sonic_mainnet:
	@yarn hardhat run scripts/deploy_periphery.ts --network sonic_mainnet

deploy.sonic_testnet:
	@yarn hardhat run scripts/deploy_periphery.ts --network sonic_testnet

