#!/bin/bash

# Deploy DLoop to Sonic Testnet
# Usage: ./scripts/dloop/deploy-sonic-testnet.sh

set -e

NETWORK="sonic_testnet"

echo "Deploying DLoop to ${NETWORK}..."
yarn hardhat deploy --tags dloop --network ${NETWORK}
echo "DLoop deployment to ${NETWORK} completed!" 