import { ethers, deployments } from "hardhat";
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
import { API3_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  OracleAggregator,
  API3Wrapper,
  API3WrapperWithThresholding,
  API3CompositeWrapperWithThresholding,
  HardPegOracleWrapper,
} from "../../typechain-types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";

/**
 * Configuration for oracle aggregator fixtures
 */
export interface OracleAggregatorFixtureConfig {
  baseCurrency: string;
  deploymentTag: string;
  oracleAggregatorId: string;
  wrapperIds: {
    api3Wrapper: string;
    api3WrapperWithThresholding: string;
    api3CompositeWrapperWithThresholding: string;
    hardPegWrapper: string;
  };
  peggedAssets: string[];
  yieldBearingAssets: string[];
  priceDecimals: number;
  heartbeatSeconds: number;
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
    yieldBearingAssets: {
      [symbol: string]: {
        address: string;
        info: TokenInfo;
      };
    };
    peggedAssets: {
      [symbol: string]: {
        address: string;
        info: TokenInfo;
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
      const peggedAssets: {
        [symbol: string]: { address: string; info: TokenInfo };
      } = {};
      for (const symbol of config.peggedAssets) {
        try {
          const { tokenInfo } = await getTokenContractForSymbol(
            { ethers, deployments } as unknown as HardhatRuntimeEnvironment,
            deployer,
            symbol
          );
          peggedAssets[symbol] = {
            address: tokenInfo.address,
            info: tokenInfo,
          };
        } catch (error) {
          console.log(
            `Warning: Could not load pegged asset ${symbol}. Skipping.`
          );
        }
      }

      const yieldBearingAssets: {
        [symbol: string]: { address: string; info: TokenInfo };
      } = {};
      for (const symbol of config.yieldBearingAssets) {
        const { tokenInfo } = await getTokenContractForSymbol(
          { ethers, deployments } as unknown as HardhatRuntimeEnvironment,
          deployer,
          symbol
        );
        yieldBearingAssets[symbol] = {
          address: tokenInfo.address,
          info: tokenInfo,
        };
      }

      // Find the mock oracle deployments
      const mockOracles: { [feedName: string]: string } = {};
      const allDeployments = await deployments.all();

      for (const [name, deployment] of Object.entries(allDeployments)) {
        if (name.startsWith("MockAPI3OracleAlwaysAlive_")) {
          const feedName = name.replace("MockAPI3OracleAlwaysAlive_", "");
          mockOracles[feedName] = deployment.address;
        }
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
          yieldBearingAssets,
          peggedAssets,
        },
        mockOracles,
      };
    }
  );
};

/**
 * Predefined configurations
 */
export const USD_ORACLE_AGGREGATOR_CONFIG: OracleAggregatorFixtureConfig = {
  baseCurrency: "USD",
  deploymentTag: "usd-oracle",
  oracleAggregatorId: USD_ORACLE_AGGREGATOR_ID,
  wrapperIds: {
    api3Wrapper: USD_API3_ORACLE_WRAPPER_ID,
    api3WrapperWithThresholding: USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
    api3CompositeWrapperWithThresholding:
      USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
    hardPegWrapper: DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  },
  peggedAssets: ["USDC", "frxUSD", "USDC"],
  yieldBearingAssets: ["sfrxUSD"],
  priceDecimals: 8,
  heartbeatSeconds: 86400,
};

export const S_ORACLE_AGGREGATOR_CONFIG: OracleAggregatorFixtureConfig = {
  baseCurrency: "wS",
  deploymentTag: "s-oracle",
  oracleAggregatorId: S_ORACLE_AGGREGATOR_ID,
  wrapperIds: {
    api3Wrapper: S_API3_ORACLE_WRAPPER_ID,
    api3WrapperWithThresholding: S_API3_WRAPPER_WITH_THRESHOLDING_ID,
    api3CompositeWrapperWithThresholding:
      S_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
    hardPegWrapper: DS_HARD_PEG_ORACLE_WRAPPER_ID,
  },
  peggedAssets: ["wS"],
  yieldBearingAssets: ["stS", "wOS"],
  priceDecimals: 8,
  heartbeatSeconds: 86400,
};

/**
 * Registry of all available oracle aggregator configurations
 */
export const ORACLE_AGGREGATOR_CONFIGS: Record<
  string,
  OracleAggregatorFixtureConfig
> = {
  USD: USD_ORACLE_AGGREGATOR_CONFIG,
  S: S_ORACLE_AGGREGATOR_CONFIG,
};

/**
 * Legacy fixture that sets up the oracle aggregator and mock oracles
 * @deprecated Use createOracleAggregatorFixture with appropriate config instead
 */
export const oracleAggregatorMinimalFixture = deployments.createFixture(
  async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["oracle-aggregator", "local-setup"]); // Include local-setup to use the mock Oracle
  }
);

/**
 * Fixture that sets up the USD oracle aggregator and mock oracles
 */
export const usdOracleAggregatorFixture = createOracleAggregatorFixture(
  USD_ORACLE_AGGREGATOR_CONFIG
);

/**
 * Fixture that sets up the S oracle aggregator and mock oracles
 */
export const sOracleAggregatorFixture = createOracleAggregatorFixture(
  S_ORACLE_AGGREGATOR_CONFIG
);

/**
 * Helper function to get an oracle aggregator fixture by currency
 * @param currency The currency to get the fixture for (e.g., "USD", "S")
 * @returns The fixture for the specified currency
 */
export const getOracleAggregatorFixture = (currency: string) => {
  const config = ORACLE_AGGREGATOR_CONFIGS[currency];
  if (!config) {
    throw new Error(
      `No oracle aggregator configuration found for currency: ${currency}`
    );
  }
  return createOracleAggregatorFixture(config);
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
