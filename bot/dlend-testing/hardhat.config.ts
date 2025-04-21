import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "dotenv/config";
import "hardhat-deploy";

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
      allowUnlimitedContractSize: true,
    },
    sonic_testnet: {
      url: `https://rpc.blaze.soniclabs.com`,
      accounts: process.env.SONIC_TESTNET_PRIVATE_KEY ? [process.env.SONIC_TESTNET_PRIVATE_KEY] : [],
    },
    sonic_mainnet: {
      url: `https://rpc.soniclabs.com`,
      accounts: process.env.SONIC_MAINNET_PRIVATE_KEY ? [process.env.SONIC_MAINNET_PRIVATE_KEY] : [],
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
};

export default config; 