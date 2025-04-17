# dLend Liquidator Bot

This project contains the smart contracts needed for the dLend liquidator bot, which automates the liquidation process for undercollateralized positions on the dLend protocol.

## Project Structure

```text
dlend-liquidator/
├── config/                 # Configuration files for different networks
│   ├── networks/           # Network-specific configurations
│   ├── config.ts           # Main config file
│   └── types.ts            # TypeScript types for configuration
├── contracts/              # Smart contracts
│   ├── aave-v3/            # AAVE V3 related liquidation contracts
│   ├── common/             # Shared contract components
│   ├── interface/          # Contract interfaces
│   └── libraries/          # Utility libraries
├── scripts/                # Deployment and interaction scripts
├── hardhat.config.ts       # Hardhat configuration
└── package.json            # Project dependencies
```

## Setup

1. Install dependencies:

```bash
yarn install
```

1. Compile contracts:

```bash
yarn compile
```

## Deployment

To deploy to Sonic mainnet:

```bash
yarn deploy:sonic
```

## Liquidator Bot

The liquidation bot uses Odos as the preferred DEX for swapping tokens during the liquidation process.
