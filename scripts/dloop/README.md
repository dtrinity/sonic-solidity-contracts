# DLoop Deployment Scripts

This directory contains shell scripts for deploying DLoop contracts to various networks.

## Available Scripts

### Generic Deployment Script

- **`deploy.sh`** - Generic deployment script that accepts network and optional reset parameters

  ```bash
  ./scripts/dloop/deploy.sh <network> [reset] [deployment_keywords]
  ```
  
  Examples:

  ```bash
  # Deploy to sonic mainnet
  ./scripts/dloop/deploy.sh sonic_mainnet
  
  # Deploy to sonic testnet with reset
  ./scripts/dloop/deploy.sh sonic_testnet true DLoop
  ```

### Network-Specific Scripts

- **`deploy-sonic-mainnet.sh`** - Deploy DLoop to Sonic Mainnet

  ```bash
  ./scripts/dloop/deploy-sonic-mainnet.sh
  ```

- **`deploy-sonic-mainnet-reset.sh`** - Deploy DLoop to Sonic Mainnet with reset

  ```bash
  ./scripts/dloop/deploy-sonic-mainnet-reset.sh
  ```

- **`deploy-sonic-testnet.sh`** - Deploy DLoop to Sonic Testnet

  ```bash
  ./scripts/dloop/deploy-sonic-testnet.sh
  ```

- **`deploy-sonic-testnet-reset.sh`** - Deploy DLoop to Sonic Testnet with reset

  ```bash
  ./scripts/dloop/deploy-sonic-testnet-reset.sh
  ```

## Migration from Makefile

These scripts replace the following Makefile targets:

- `make deploy.dloop.sonic_mainnet` → `./scripts/dloop/deploy-sonic-mainnet.sh`
- `make deploy.dloop.sonic_mainnet.reset` → `./scripts/dloop/deploy-sonic-mainnet-reset.sh`
- `make deploy.dloop.sonic_testnet` → `./scripts/dloop/deploy-sonic-testnet.sh`
- `make deploy.dloop.sonic_testnet.reset` → `./scripts/dloop/deploy-sonic-testnet-reset.sh`
- `make deploy.dloop network=<network>` → `./scripts/dloop/deploy.sh <network>`

## Prerequisites

- Node.js and Yarn installed
- Hardhat configured with appropriate network settings
- Required environment variables set for the target network
