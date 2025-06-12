#!/bin/bash

# Deploy DLoop to Sonic Testnet with Reset
# Usage: ./scripts/dloop/deploy-sonic-testnet-reset.sh

set -e

NETWORK="sonic_testnet"
DEPLOYMENT_KEYWORDS="DLoop,OdosSwapLogic"

echo "Resetting deployments for ${NETWORK}..."
./scripts/deployments/clean-deployments.sh ${DEPLOYMENT_KEYWORDS} ${NETWORK}

echo "Deploying DLoop to ${NETWORK}..."
yarn hardhat deploy --tags dloop --network ${NETWORK}
echo "DLoop deployment to ${NETWORK} with reset completed!" 