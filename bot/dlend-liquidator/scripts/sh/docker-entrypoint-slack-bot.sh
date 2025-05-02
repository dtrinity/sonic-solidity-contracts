#!/bin/sh

# Check if the network is provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <network> <healthFactorBatchSize>"
  exit 1
fi

HEALTH_FACTOR_BATCH_SIZE=$2 yarn hardhat run \
  --network $1 \
  /usr/src/scripts/liquidator-bot/slack-reporter/run.ts
