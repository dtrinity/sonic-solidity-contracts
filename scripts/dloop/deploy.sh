#!/bin/bash

# Deploy DLoop to specified network
# Usage: ./scripts/dloop/deploy.sh <network> [reset] [deployment_keywords]
# Examples:
#   ./scripts/dloop/deploy.sh sonic_mainnet
#   ./scripts/dloop/deploy.sh sonic_testnet true DLoop

set -e

NETWORK=$1
RESET=$2
DEPLOYMENT_KEYWORDS=$3

if [ -z "$NETWORK" ]; then
    echo "Error: Must provide 'network' argument"
    echo "Usage: $0 <network> [reset] [deployment_keywords]"
    exit 1
fi

if [ "$RESET" = "true" ]; then
    if [ -z "$DEPLOYMENT_KEYWORDS" ]; then
        echo "Error: Must provide 'deployment_keywords' argument when reset=true"
        echo "Usage: $0 <network> [reset] [deployment_keywords]"
        exit 1
    fi
    echo "Resetting deployments for ${NETWORK}..."
    ./scripts/deployment/clean-deployments.sh ${DEPLOYMENT_KEYWORDS} ${NETWORK}
fi

echo "Deploying DLoop to ${NETWORK}..."
yarn hardhat deploy --tags dloop --network ${NETWORK}
echo "DLoop deployment to ${NETWORK} completed!" 