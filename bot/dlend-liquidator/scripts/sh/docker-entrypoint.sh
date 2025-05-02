# Check if the network is provided
if [ -z "$1" ]; then
  echo "Please provide the network name as the first argument"
  exit 1
fi

if [ -z "$2" ]; then
  echo "Please provide the DEX name as the second argument"
  exit 1
fi

yarn hardhat run \
  --network $1 \
  /usr/src/scripts/liquidator-bot/$2\_bot/run.ts
