import { ethers } from "ethers";

/**
 * Get the default private keys list for a specific network from the mnemonics in the `.env` file
 *
 * @param network - The network name
 * @returns A list of configured private keys for the network
 */
export function getEnvPrivateKeys(network: string): string[] {
  let pks: string[] = [];

  switch (network) {
    case "sonic_testnet":
      pks = [getPrivateKeyFromMnemonic(`testnet_deployer`)];
      break;
    case "sonic_mainnet":
      pks = [getPrivateKeyFromMnemonic(`mainnet_deployer`)];
      break;
    default:
      throw new Error(`Unsupported network: ${network}`);
  }

  // Filter out Zero private keys
  pks = pks.filter(
    (pk) =>
      pk !==
      "0x0000000000000000000000000000000000000000000000000000000000000000"
  );

  if (pks.length === 0) {
    console.log(`No private keys found for ${network} in the .env file`);
    return [];
  }

  // Make sure there is no duplicated private key
  const uniquePks = Array.from(new Set(pks));

  if (uniquePks.length !== pks.length) {
    throw new Error(`Duplicated private keys detected in the .env file`);
  }

  return pks;
}

/**
 * Get the private key by deriving it from the mnemonic in the `.env` file
 *
 * @param envNamePostfix - The postfix of the environment variable name (`MNEMONIC_<POSTFIX>`) in the `.env` file
 * @returns The default private key
 */
export function getPrivateKeyFromMnemonic(envNamePostfix: string): string {
  const mnemonicKey = "MNEMONIC_" + envNamePostfix.toUpperCase();
  const mnemonic = process.env[mnemonicKey];

  if (!mnemonic || mnemonic === "") {
    // We do not throw an error here to avoid blocking the localhost and local hardhat
    // as it will also need to initialize the hardhat.config.ts
    console.log(`${mnemonicKey} is not set in the .env file`);
    // Return a dummy private key in 32 bytes format to avoid breaking the compilation
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }

  const wallet = ethers.Wallet.fromPhrase(mnemonic);
  return wallet.privateKey;
}

/**
 * Get the private key from the environment variable
 *
 * @param envNamePostfix - The postfix of the environment variable name (`PK_<POSTFIX>`) in the `.env` file
 * @returns The private key
 */
export function getPrivateKeyFromEnv(envNamePostfix: string): string {
  const envName = "PK_" + envNamePostfix.toUpperCase();
  const privateKey = process.env[envName];

  if (!privateKey || privateKey === "") {
    console.log(`${envName} is not set in the .env file`);
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  return privateKey;
}

/**
 * Get the standard named accounts
 *
 * @returns A list of account names to indexes
 */
export function getStandardNamedAccounts(): {
  [name: string]:
    | string
    | number
    | {
        [network: string]: string | number | null;
      };
} {
  return {
    /* eslint-disable camelcase -- Use camelcase for network config  */
    // Standard accounts
    deployer: {
      hardhat: 0,
      localhost: 0,
      sonic_testnet: 0,
      sonic_mainnet: 0,
    },
    // For testing ONLY
    user1: {
      hardhat: 1,
      localhost: 1,
    },
    user2: {
      hardhat: 2,
      localhost: 2,
    },
    /* eslint-enable camelcase -- Use camelcase for network config */
  };
}
