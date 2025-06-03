#!/bin/bash

# Deploy DLoop to Sonic Mainnet
# Usage: ./scripts/dloop/deploy-sonic-mainnet.sh

set -e

NETWORK="sonic_mainnet"

echo "Deploying DLoop to ${NETWORK}..."
yarn hardhat deploy --tags dloop --network ${NETWORK}
echo "DLoop deployment to ${NETWORK} completed!" 