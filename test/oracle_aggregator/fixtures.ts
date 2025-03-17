import { deployments } from "hardhat";
import hre from "hardhat";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  S_ORACLE_AGGREGATOR_ID,
  S_API3_ORACLE_WRAPPER_ID,
  S_API3_WRAPPER_WITH_THRESHOLDING_ID,
  S_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  DS_HARD_PEG_ORACLE_WRAPPER_ID,
} from "../../typescript/deploy-ids";
import {
  OracleAggregator,
  API3Wrapper,
  API3WrapperWithThresholding,
  API3CompositeWrapperWithThresholding,
  HardPegOracleWrapper,
} from "../../typechain-types";
import { getConfig } from "../../config/config";
import { OracleAggregatorConfig } from "../../config/types";

/**
 * Configuration for oracle aggregator fixtures
 */
export interface OracleAggregatorFixtureConfig extends OracleAggregatorConfig {
  currency: string;
  deploymentTag: string;
  oracleAggregatorId: string;
  wrapperIds: {
    api3Wrapper: string;
    api3WrapperWithThresholding: string;
    api3CompositeWrapperWithThresholding: string;
    hardPegWrapper: string;
  };
}

/**
 * Return type for oracle aggregator fixtures
 */
export interface OracleAggregatorFixtureResult {
  config: OracleAggregatorFixtureConfig;
  contracts: {
    oracleAggregator: OracleAggregator;
    api3Wrapper: API3Wrapper;
    api3WrapperWithThresholding: API3WrapperWithThresholding;
    api3CompositeWrapperWithThresholding: API3CompositeWrapperWithThresholding;
    hardPegWrapper?: HardPegOracleWrapper;
  };
  assets: {
    plainAssets: {
      [address: string]: {
        address: string;
        proxy: string;
      };
    };
    thresholdAssets: {
      [address: string]: {
        address: string;
        proxy: string;
        lowerThreshold: bigint;
        fixedPrice: bigint;
      };
    };
    compositeAssets: {
      [address: string]: {
        address: string;
        feedAsset: string;
        proxy1: string;
        proxy2: string;
        lowerThresholdInBase1: bigint;
        fixedPriceInBase1: bigint;
        lowerThresholdInBase2: bigint;
        fixedPriceInBase2: bigint;
      };
    };
  };
  mockOracles: {
    [feedName: string]: string;
  };
}

/**
 * Create a fixture factory for any oracle aggregator based on its configuration
 */
export const createOracleAggregatorFixture = (
  config: OracleAggregatorFixtureConfig
) => {
  return deployments.createFixture(
    async ({
      deployments,
      getNamedAccounts,
      ethers,
    }): Promise<OracleAggregatorFixtureResult> => {
      const { deployer } = await getNamedAccounts();

      await deployments.fixture(); // Start from a fresh deployment
      await deployments.fixture([config.deploymentTag, "local-setup"]); // Include local-setup to use the mock Oracle

      // Get contract instances
      const { address: oracleAggregatorAddress } = await deployments.get(
        config.oracleAggregatorId
      );
      const oracleAggregator = await ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress
      );

      const { address: api3WrapperAddress } = await deployments.get(
        config.wrapperIds.api3Wrapper
      );
      const api3Wrapper = await ethers.getContractAt(
        "API3Wrapper",
        api3WrapperAddress
      );

      const { address: api3WrapperWithThresholdingAddress } =
        await deployments.get(config.wrapperIds.api3WrapperWithThresholding);
      const api3WrapperWithThresholding = await ethers.getContractAt(
        "API3WrapperWithThresholding",
        api3WrapperWithThresholdingAddress
      );

      const { address: api3CompositeWrapperWithThresholdingAddress } =
        await deployments.get(
          config.wrapperIds.api3CompositeWrapperWithThresholding
        );
      const api3CompositeWrapperWithThresholding = await ethers.getContractAt(
        "API3CompositeWrapperWithThresholding",
        api3CompositeWrapperWithThresholdingAddress
      );

      const { address: hardPegWrapperAddress } = await deployments.get(
        config.wrapperIds.hardPegWrapper
      );
      const hardPegWrapper = await ethers.getContractAt(
        "HardPegOracleWrapper",
        hardPegWrapperAddress
      );

      // Find the mock oracle deployments
      const mockOracles: { [feedName: string]: string } = {};
      const allDeployments = await deployments.all();

      for (const [name, deployment] of Object.entries(allDeployments)) {
        if (name.startsWith("MockAPI3OracleAlwaysAlive_")) {
          const feedName = name.replace("MockAPI3OracleAlwaysAlive_", "");
          mockOracles[feedName] = deployment.address;
        }
      }

      // Group assets by their oracle type
      const plainAssets: {
        [address: string]: { address: string; proxy: string };
      } = {};
      const thresholdAssets: {
        [address: string]: {
          address: string;
          proxy: string;
          lowerThreshold: bigint;
          fixedPrice: bigint;
        };
      } = {};
      const compositeAssets: {
        [address: string]: {
          address: string;
          feedAsset: string;
          proxy1: string;
          proxy2: string;
          lowerThresholdInBase1: bigint;
          fixedPriceInBase1: bigint;
          lowerThresholdInBase2: bigint;
          fixedPriceInBase2: bigint;
        };
      } = {};

      // Populate plain assets
      for (const [address, proxy] of Object.entries(
        config.api3OracleAssets.plainApi3OracleWrappers
      )) {
        plainAssets[address] = {
          address,
          proxy,
        };
      }

      // Populate threshold assets
      for (const [address, data] of Object.entries(
        config.api3OracleAssets.api3OracleWrappersWithThresholding
      )) {
        thresholdAssets[address] = {
          address,
          proxy: data.proxy,
          lowerThreshold: data.lowerThreshold,
          fixedPrice: data.fixedPrice,
        };
      }

      // Populate composite assets
      for (const [address, data] of Object.entries(
        config.api3OracleAssets.compositeApi3OracleWrappersWithThresholding
      )) {
        compositeAssets[address] = {
          address,
          feedAsset: data.feedAsset,
          proxy1: data.proxy1,
          proxy2: data.proxy2,
          lowerThresholdInBase1: data.lowerThresholdInBase1,
          fixedPriceInBase1: data.fixedPriceInBase1,
          lowerThresholdInBase2: data.lowerThresholdInBase2,
          fixedPriceInBase2: data.fixedPriceInBase2,
        };
      }

      return {
        config,
        contracts: {
          oracleAggregator,
          api3Wrapper,
          api3WrapperWithThresholding,
          api3CompositeWrapperWithThresholding,
          hardPegWrapper,
        },
        assets: {
          plainAssets,
          thresholdAssets,
          compositeAssets,
        },
        mockOracles,
      };
    }
  );
};

/**
 * Helper function to get an oracle aggregator fixture by currency
 * @param currency The currency to get the fixture for (e.g., "USD", "S")
 * @returns The fixture for the specified currency
 */
export const getOracleAggregatorFixture = async (currency: string) => {
  const networkConfig = await getConfig(hre);
  const oracleConfig = networkConfig.oracleAggregators[currency];

  if (!oracleConfig) {
    throw new Error(
      `No oracle aggregator configuration found for currency: ${currency}`
    );
  }

  // Map the network config to our fixture config
  const fixtureConfig: OracleAggregatorFixtureConfig = {
    ...oracleConfig,
    currency,
    deploymentTag: `${currency.toLowerCase()}-oracle`,
    oracleAggregatorId:
      currency === "USD" ? USD_ORACLE_AGGREGATOR_ID : S_ORACLE_AGGREGATOR_ID,
    wrapperIds: {
      api3Wrapper:
        currency === "USD"
          ? USD_API3_ORACLE_WRAPPER_ID
          : S_API3_ORACLE_WRAPPER_ID,
      api3WrapperWithThresholding:
        currency === "USD"
          ? USD_API3_WRAPPER_WITH_THRESHOLDING_ID
          : S_API3_WRAPPER_WITH_THRESHOLDING_ID,
      api3CompositeWrapperWithThresholding:
        currency === "USD"
          ? USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID
          : S_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
      hardPegWrapper:
        currency === "USD"
          ? DUSD_HARD_PEG_ORACLE_WRAPPER_ID
          : DS_HARD_PEG_ORACLE_WRAPPER_ID,
    },
  };

  return createOracleAggregatorFixture(fixtureConfig);
};

/**
 * Helper function to check if an asset has a mock oracle
 * @param mockOracles The mock oracles object from the fixture
 * @param assetSymbol The asset symbol to check
 * @param baseCurrency The base currency (e.g., "USD", "wS")
 * @returns True if the asset has a mock oracle, false otherwise
 */
export function hasOracleForAsset(
  mockOracles: { [feedName: string]: string },
  assetSymbol: string,
  baseCurrency: string
): boolean {
  const directFeed = `${assetSymbol}_${baseCurrency}`;
  return directFeed in mockOracles;
}

/**
 * Helper function to log available oracles for debugging
 * @param mockOracles The mock oracles object from the fixture
 */
export function logAvailableOracles(mockOracles: {
  [feedName: string]: string;
}): void {
  console.log("Available mock oracles:");
  for (const [feedName, address] of Object.entries(mockOracles)) {
    console.log(`  ${feedName}: ${address}`);
  }
}

/**
 * Helper function to get a random test asset from the available assets
 * @param fixtureResult The fixture result containing the assets
 * @returns A randomly selected asset address
 * @throws Error if no assets are available
 */
export function getRandomTestAsset(
  fixtureResult: OracleAggregatorFixtureResult
): string {
  const allAssets = [
    ...Object.keys(fixtureResult.assets.plainAssets),
    ...Object.keys(fixtureResult.assets.thresholdAssets),
    ...Object.keys(fixtureResult.assets.compositeAssets),
  ];

  if (allAssets.length === 0) {
    throw new Error("No assets configured in the fixture");
  }

  const randomIndex = Math.floor(Math.random() * allAssets.length);
  return allAssets[randomIndex];
}
