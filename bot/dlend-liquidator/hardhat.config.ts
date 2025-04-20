import "@typechain/hardhat";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "dotenv/config";
// Import hardhat-verify last to avoid task redefinition issues
import "@nomicfoundation/hardhat-verify";

import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      deploy: ["deploy-mocks", "deploy"],
      allowUnlimitedContractSize: true,
      saveDeployments: false, // allow testing without needing to remove the previous deployments
    },
    localhost: {
      deploy: ["deploy-mocks", "deploy"],
      saveDeployments: true,
    },
    sonic_mainnet: {
      // Documentation: https://docs.soniclabs.com/sonic/build-on-sonic/getting-started
      url: `https://rpc.sonic.soniclabs.com`,
      deploy: ["deploy"],
      saveDeployments: true,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    liquidatorBot: {
      default: 1,
    },
    liquidatorBotDeployer: {
      default: 0, // Use the deployer address for the liquidator bot deployment
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deployments: "./deployments",
    deploy: "./deploy",
  },
  gasReporter: {
    enabled: false, // Enable this when testing new complex functions
  },
  // Configure etherscan (verification) separately to avoid conflicts
  etherscan: {
    apiKey: {
      // For non-Ethereum networks, the API key is often a placeholder
      sonic_mainnet: "sonic",
    },
  },
};

export default config; 