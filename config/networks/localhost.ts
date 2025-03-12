import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { Config } from "../types";

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(
  _hre: HardhatRuntimeEnvironment,
): Promise<Config> {
  // Token info will only be populated after their deployment
  const dUSDDeployment = await _hre.deployments.getOrNull("dUSD");
  const dSDeployment = await _hre.deployments.getOrNull("dS");
  const USDCDeployment = await _hre.deployments.getOrNull("USDC");
  const USDSDeployment = await _hre.deployments.getOrNull("USDS");
  const sUSDSDeployment = await _hre.deployments.getOrNull("sUSDS");
  const frxUSDDeployment = await _hre.deployments.getOrNull("frxUSD");
  const sfrxUSDDeployment = await _hre.deployments.getOrNull("sfrxUSD");
  const wSTokenDeployment = await _hre.deployments.getOrNull("wS");
  const wOSTokenDeployment = await _hre.deployments.getOrNull("wOS");
  const stSTokenDeployment = await _hre.deployments.getOrNull("stS");

  // Get mock oracle deployments
  const mockOracleDeployments: Record<string, string> = {};
  const mockOracleDeploymentsAll = await _hre.deployments.all();

  for (const [name, deployment] of Object.entries(mockOracleDeploymentsAll)) {
    if (name.startsWith("MockAPI3OracleAlwaysAlive_")) {
      // Extract the feed name from the deployment name
      const feedName = name.replace("MockAPI3OracleAlwaysAlive_", "");
      mockOracleDeployments[feedName] = deployment.address;
    }
  }

  // Define the threshold value (1.0 with appropriate decimals)
  const thresholdValue = 10n ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS);

  return {
    MOCK_ONLY: {
      tokens: {
        USDC: {
          name: "USD Coin",
          address: USDCDeployment?.address,
          decimals: 6,
          initialSupply: 1e6,
        },
        USDS: {
          name: "USDS Stablecoin",
          address: USDSDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        sUSDS: {
          name: "Savings USDS",
          address: sUSDSDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        frxUSD: {
          name: "Frax USD",
          address: frxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        sfrxUSD: {
          name: "Staked Frax USD",
          address: sfrxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        wS: {
          name: "Wrapped S",
          address: wSTokenDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        wOS: {
          name: "Wrapped Origin S",
          address: wOSTokenDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        stS: {
          name: "Staked S",
          address: stSTokenDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
      },
    },
    tokenAddresses: {
      dUSD: emptyStringIfUndefined(dUSDDeployment?.address),
      dS: emptyStringIfUndefined(dSDeployment?.address),
      wS: emptyStringIfUndefined(wSTokenDeployment?.address),
    },
    oracleAggregator: {
      hardDStablePeg: 10 ** ORACLE_AGGREGATOR_PRICE_DECIMALS,
      priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
      api3OracleAssets: {
        // No thresholding, passthrough raw prices
        plainApi3OracleWrappers: {
          ...(wOSTokenDeployment?.address && mockOracleDeployments["wOS_S"]
            ? {
                [wOSTokenDeployment.address]: mockOracleDeployments["wOS_S"],
              }
            : {}),
          ...(stSTokenDeployment?.address && mockOracleDeployments["stS_S"]
            ? {
                [stSTokenDeployment.address]: mockOracleDeployments["stS_S"],
              }
            : {}),
        },
        // Threshold the stablecoins
        api3OracleWrappersWithThresholding: {
          ...(USDCDeployment?.address && mockOracleDeployments["USDC_USD"]
            ? {
                [USDCDeployment.address]: {
                  proxy: mockOracleDeployments["USDC_USD"],
                  lowerThreshold: thresholdValue,
                  fixedPrice: thresholdValue,
                },
              }
            : {}),
          ...(USDSDeployment?.address && mockOracleDeployments["USDS_USD"]
            ? {
                [USDSDeployment.address]: {
                  proxy: mockOracleDeployments["USDS_USD"],
                  lowerThreshold: thresholdValue,
                  fixedPrice: thresholdValue,
                },
              }
            : {}),
          ...(frxUSDDeployment?.address && mockOracleDeployments["frxUSD_USD"]
            ? {
                [frxUSDDeployment.address]: {
                  proxy: mockOracleDeployments["frxUSD_USD"],
                  lowerThreshold: thresholdValue,
                  fixedPrice: thresholdValue,
                },
              }
            : {}),
          ...(wSTokenDeployment?.address && mockOracleDeployments["wS_USD"]
            ? {
                [wSTokenDeployment.address]: {
                  proxy: mockOracleDeployments["wS_USD"],
                  lowerThreshold: thresholdValue,
                  fixedPrice: thresholdValue,
                },
              }
            : {}),
        },

        // Composite API3 oracle wrappers for sUSDS and sfrxUSD
        compositeApi3OracleWrappersWithThresholding: {
          // sUSDS composite feed (sUSDS/USDS * USDS/USD)
          ...(sUSDSDeployment?.address &&
          mockOracleDeployments["sUSDS_USDS"] &&
          mockOracleDeployments["USDS_USD"]
            ? {
                [sUSDSDeployment.address]: {
                  feedAsset: sUSDSDeployment.address,
                  proxy1: mockOracleDeployments["sUSDS_USDS"],
                  proxy2: mockOracleDeployments["USDS_USD"],
                  lowerThresholdInBase1: 0n, // No threshold for sUSDS/USDS
                  fixedPriceInBase1: 0n,
                  lowerThresholdInBase2: thresholdValue, // Threshold for USDS/USD
                  fixedPriceInBase2: thresholdValue,
                },
              }
            : {}),

          // sfrxUSD composite feed (sfrxUSD/frxUSD * frxUSD/USD)
          ...(sfrxUSDDeployment?.address &&
          mockOracleDeployments["sfrxUSD_frxUSD"] &&
          mockOracleDeployments["frxUSD_USD"]
            ? {
                [sfrxUSDDeployment.address]: {
                  feedAsset: sfrxUSDDeployment.address,
                  proxy1: mockOracleDeployments["sfrxUSD_frxUSD"],
                  proxy2: mockOracleDeployments["frxUSD_USD"],
                  lowerThresholdInBase1: 0n, // No threshold for sfrxUSD/frxUSD
                  fixedPriceInBase1: 0n,
                  lowerThresholdInBase2: thresholdValue, // Threshold for frxUSD/USD
                  fixedPriceInBase2: thresholdValue,
                },
              }
            : {}),
        },
      },
    },
  };
}

/**
 * Return an empty string if the value is undefined
 *
 * @param value - The value to check
 * @returns An empty string if the value is undefined, otherwise the value itself
 */
function emptyStringIfUndefined(value: string | undefined): string {
  return value ?? "";
}
