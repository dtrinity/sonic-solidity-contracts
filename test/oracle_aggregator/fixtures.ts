import hre, { deployments } from "hardhat";

import { getConfig } from "../../config/config";
import { OracleAggregatorConfig } from "../../config/types";
import {
  API3CompositeWrapperWithThresholding,
  API3Wrapper,
  API3WrapperWithThresholding,
  HardPegOracleWrapper,
  OracleAggregator,
  RedstoneChainlinkCompositeWrapperWithThresholding,
  RedstoneChainlinkWrapper,
  RedstoneChainlinkWrapperWithThresholding,
} from "../../typechain-types";
import {
  DS_HARD_PEG_ORACLE_WRAPPER_ID,
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  S_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  S_API3_ORACLE_WRAPPER_ID,
  S_API3_WRAPPER_WITH_THRESHOLDING_ID,
  S_ORACLE_AGGREGATOR_ID,
  S_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  S_REDSTONE_ORACLE_WRAPPER_ID,
  S_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

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
    redstoneChainlinkWrapper: string;
    redstoneChainlinkWrapperWithThresholding: string;
    redstoneChainlinkCompositeWrapperWithThresholding: string;
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
    redstoneChainlinkWrapper: RedstoneChainlinkWrapper;
    redstoneChainlinkWrapperWithThresholding: RedstoneChainlinkWrapperWithThresholding;
    redstoneChainlinkCompositeWrapperWithThresholding: RedstoneChainlinkCompositeWrapperWithThresholding;
  };
  assets: {
    allAssets: string[];
    // API3 Assets
    api3PlainAssets: { [address: string]: { address: string; proxy: string } };
    api3ThresholdAssets: {
      [address: string]: {
        address: string;
        proxy: string;
        lowerThreshold: bigint;
        fixedPrice: bigint;
      };
    };
    api3CompositeAssets: {
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
    // Redstone Assets
    redstonePlainAssets: {
      [address: string]: { address: string; feed: string };
    };
    redstoneThresholdAssets: {
      [address: string]: {
        address: string;
        feed: string;
        lowerThreshold: bigint;
        fixedPrice: bigint;
      };
    };
    redstoneCompositeAssets: {
      [address: string]: {
        address: string;
        feedAsset: string;
        feed1: string;
        feed2: string;
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
 *
 * @param config
 */
export const createOracleAggregatorFixture = (
  config: OracleAggregatorFixtureConfig,
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
        config.oracleAggregatorId,
      );
      const oracleAggregator = await ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
      );

      const { address: api3WrapperAddress } = await deployments.get(
        config.wrapperIds.api3Wrapper,
      );
      const api3Wrapper = await ethers.getContractAt(
        "API3Wrapper",
        api3WrapperAddress,
      );

      const { address: api3WrapperWithThresholdingAddress } =
        await deployments.get(config.wrapperIds.api3WrapperWithThresholding);
      const api3WrapperWithThresholding = await ethers.getContractAt(
        "API3WrapperWithThresholding",
        api3WrapperWithThresholdingAddress,
      );

      const { address: api3CompositeWrapperWithThresholdingAddress } =
        await deployments.get(
          config.wrapperIds.api3CompositeWrapperWithThresholding,
        );
      const api3CompositeWrapperWithThresholding = await ethers.getContractAt(
        "API3CompositeWrapperWithThresholding",
        api3CompositeWrapperWithThresholdingAddress,
      );

      const { address: hardPegWrapperAddress } = await deployments.get(
        config.wrapperIds.hardPegWrapper,
      );
      const hardPegWrapper = await ethers.getContractAt(
        "HardPegOracleWrapper",
        hardPegWrapperAddress,
      );

      // Get Redstone wrapper instances
      const { address: redstoneChainlinkWrapperAddress } =
        await deployments.get(config.wrapperIds.redstoneChainlinkWrapper);
      const redstoneChainlinkWrapper = await ethers.getContractAt(
        "RedstoneChainlinkWrapper",
        redstoneChainlinkWrapperAddress,
      );

      const { address: redstoneChainlinkWrapperWithThresholdingAddress } =
        await deployments.get(
          config.wrapperIds.redstoneChainlinkWrapperWithThresholding,
        );
      const redstoneChainlinkWrapperWithThresholding =
        await ethers.getContractAt(
          "RedstoneChainlinkWrapperWithThresholding",
          redstoneChainlinkWrapperWithThresholdingAddress,
        );

      const {
        address: redstoneChainlinkCompositeWrapperWithThresholdingAddress,
      } = await deployments.get(
        config.wrapperIds.redstoneChainlinkCompositeWrapperWithThresholding,
      );
      const redstoneChainlinkCompositeWrapperWithThresholding =
        await ethers.getContractAt(
          "RedstoneChainlinkCompositeWrapperWithThresholding",
          redstoneChainlinkCompositeWrapperWithThresholdingAddress,
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

      // Group API3 assets by their oracle type
      const api3PlainAssets: {
        [address: string]: { address: string; proxy: string };
      } = {};
      const api3ThresholdAssets: {
        [address: string]: {
          address: string;
          proxy: string;
          lowerThreshold: bigint;
          fixedPrice: bigint;
        };
      } = {};
      const api3CompositeAssets: {
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

      // Populate API3 plain assets
      for (const [address, proxy] of Object.entries(
        config.api3OracleAssets.plainApi3OracleWrappers,
      )) {
        api3PlainAssets[address] = {
          address,
          proxy,
        };
      }

      // Populate API3 threshold assets
      for (const [address, data] of Object.entries(
        config.api3OracleAssets.api3OracleWrappersWithThresholding,
      )) {
        api3ThresholdAssets[address] = {
          address,
          proxy: data.proxy,
          lowerThreshold: data.lowerThreshold,
          fixedPrice: data.fixedPrice,
        };
      }

      // Populate API3 composite assets
      for (const [address, data] of Object.entries(
        config.api3OracleAssets.compositeApi3OracleWrappersWithThresholding,
      )) {
        api3CompositeAssets[address] = {
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

      // Group Redstone assets by their oracle type
      const redstonePlainAssets: {
        [address: string]: { address: string; feed: string };
      } = {};
      const redstoneThresholdAssets: {
        [address: string]: {
          address: string;
          feed: string;
          lowerThreshold: bigint;
          fixedPrice: bigint;
        };
      } = {};
      const redstoneCompositeAssets: {
        [address: string]: {
          address: string;
          feedAsset: string;
          feed1: string;
          feed2: string;
          lowerThresholdInBase1: bigint;
          fixedPriceInBase1: bigint;
          lowerThresholdInBase2: bigint;
          fixedPriceInBase2: bigint;
        };
      } = {};

      // Populate Redstone plain assets
      for (const [address, feed] of Object.entries(
        config.redstoneOracleAssets.plainRedstoneOracleWrappers,
      )) {
        redstonePlainAssets[address] = {
          address,
          feed,
        };
      }

      // Populate Redstone threshold assets
      for (const [address, data] of Object.entries(
        config.redstoneOracleAssets.redstoneOracleWrappersWithThresholding,
      )) {
        redstoneThresholdAssets[address] = {
          address,
          feed: data.feed,
          lowerThreshold: data.lowerThreshold,
          fixedPrice: data.fixedPrice,
        };
      }

      // Populate Redstone composite assets
      for (const [address, data] of Object.entries(
        config.redstoneOracleAssets
          .compositeRedstoneOracleWrappersWithThresholding,
      )) {
        redstoneCompositeAssets[address] = {
          address,
          feedAsset: data.feedAsset,
          feed1: data.feed1,
          feed2: data.feed2,
          lowerThresholdInBase1: data.lowerThresholdInBase1,
          fixedPriceInBase1: data.fixedPriceInBase1,
          lowerThresholdInBase2: data.lowerThresholdInBase2,
          fixedPriceInBase2: data.fixedPriceInBase2,
        };
      }

      const allAssets = Object.keys(api3PlainAssets).concat(
        Object.keys(api3ThresholdAssets),
        Object.keys(api3CompositeAssets),
        Object.keys(redstonePlainAssets),
        Object.keys(redstoneThresholdAssets),
        Object.keys(redstoneCompositeAssets),
      );

      return {
        config,
        contracts: {
          oracleAggregator,
          api3Wrapper,
          api3WrapperWithThresholding,
          api3CompositeWrapperWithThresholding,
          hardPegWrapper,
          redstoneChainlinkWrapper,
          redstoneChainlinkWrapperWithThresholding,
          redstoneChainlinkCompositeWrapperWithThresholding,
        },
        assets: {
          allAssets,
          // API3 Assets
          api3PlainAssets,
          api3ThresholdAssets,
          api3CompositeAssets,
          // Redstone Assets
          redstonePlainAssets,
          redstoneThresholdAssets,
          redstoneCompositeAssets,
        },
        mockOracles,
      };
    },
  );
};

/**
 * Helper function to get an oracle aggregator fixture by currency
 *
 * @param currency The currency to get the fixture for (e.g., "USD", "S")
 * @returns The fixture for the specified currency
 */
export const getOracleAggregatorFixture = async (currency: string) => {
  const config = await getConfig(hre);
  const oracleAggregatorConfig = config.oracleAggregators[currency];

  if (!oracleAggregatorConfig) {
    throw new Error(
      `No oracle aggregator config found for currency ${currency}`,
    );
  }

  const fixtureConfig: OracleAggregatorFixtureConfig = {
    ...oracleAggregatorConfig,
    currency,
    deploymentTag: currency === "USD" ? "dusd-ecosystem" : "ds-ecosystem",
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
      redstoneChainlinkWrapper:
        currency === "USD"
          ? USD_REDSTONE_ORACLE_WRAPPER_ID
          : S_REDSTONE_ORACLE_WRAPPER_ID,
      redstoneChainlinkWrapperWithThresholding:
        currency === "USD"
          ? USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID
          : S_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
      redstoneChainlinkCompositeWrapperWithThresholding:
        currency === "USD"
          ? USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID
          : S_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
    },
  };

  return createOracleAggregatorFixture(fixtureConfig);
};

/**
 * Helper function to check if an asset has a mock oracle
 *
 * @param mockOracles The mock oracles object from the fixture
 * @param assetSymbol The asset symbol to check
 * @param baseCurrency The base currency (e.g., "USD", "wS")
 * @returns True if the asset has a mock oracle, false otherwise
 */
export function hasOracleForAsset(
  mockOracles: { [feedName: string]: string },
  assetSymbol: string,
  baseCurrency: string,
): boolean {
  const directFeed = `${assetSymbol}_${baseCurrency}`;
  return directFeed in mockOracles;
}

/**
 * Helper function to log available oracles for debugging
 *
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
 * Helper function to get a random item from a list
 *
 * @param list The list to get a random item from
 * @returns A randomly selected item from the list
 * @throws Error if the list is empty
 */
export function getRandomItemFromList(list: string[]): string {
  if (list.length === 0) {
    throw new Error("List is empty");
  }
  const randomIndex = Math.floor(Math.random() * list.length);
  return list[randomIndex];
}
