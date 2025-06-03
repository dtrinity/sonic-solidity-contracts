import "@typechain/hardhat";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import "dotenv/config";

import { HardhatUserConfig } from "hardhat/config";

import { getEnvPrivateKeys } from "./typescript/hardhat/named-accounts";

/* eslint-disable camelcase -- Network names follow specific naming conventions that require snake_case */
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
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
    sonic_testnet: {
      // https://docs.soniclabs.com/sonic/build-on-sonic/getting-started
      url: `https://rpc.blaze.soniclabs.com`,
      deploy: ["deploy-mocks", "deploy"],
      saveDeployments: true,
      accounts: getEnvPrivateKeys("sonic_testnet"),
    },
    sonic_mainnet: {
      url: `https://rpc.soniclabs.com`,
      deploy: ["deploy"], // NOTE: DO NOT DEPLOY mocks
      saveDeployments: true,
      accounts: getEnvPrivateKeys("sonic_mainnet"),
    },
  },
  namedAccounts: {
    deployer: 0,
    user1: 1,
    user2: 2,
    user3: 3,
    user4: 4,
    user5: 5,
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
  etherscan: {
    // Used for verifying single contracts when hardhat-deploy auto verify doesn't work
    apiKey: {
      sonic_mainnet: "4EJCRRD3JKIE6TKF6ME7AKVYWFEJI79A26",
    },
    customChains: [
      {
        network: "sonic_mainnet",
        chainId: 146,
        urls: {
          apiURL: "https://api.sonicscan.org/api",
          browserURL: "https://sonicscan.org",
        },
      },
    ],
  },
  sourcify: {
    // Just here to mute warning
    enabled: false,
  },
};
/* eslint-enable camelcase -- Re-enabling camelcase rule after network definitions */

export default config;
