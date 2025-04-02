import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { DS_TOKEN_ID, DUSD_TOKEN_ID } from "../../typescript/deploy-ids";
import {
  ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  ORACLE_AGGREGATOR_PRICE_DECIMALS,
} from "../../typescript/oracle_aggregator/constants";
import {
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
  rateStrategyMediumLiquidityStable,
  rateStrategyMediumLiquidityVolatile,
} from "../dlend/interest-rate-strategies";
import {
  strategyDStable,
  strategyYieldBearingStablecoin,
} from "../dlend/reserves-params";
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
  const dUSDDeployment = await _hre.deployments.getOrNull(DUSD_TOKEN_ID);
  const dSDeployment = await _hre.deployments.getOrNull(DS_TOKEN_ID);
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
  // Get the named accounts
  const { user1 } = await _hre.getNamedAccounts();

  for (const [name, deployment] of Object.entries(mockOracleDeploymentsAll)) {
    if (name.startsWith("MockAPI3OracleAlwaysAlive_")) {
      // Extract the feed name from the deployment name
      const feedName = name.replace("MockAPI3OracleAlwaysAlive_", "");
      mockOracleDeployments[feedName] = deployment.address;
    }
  }

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
      stS: emptyStringIfUndefined(stSTokenDeployment?.address),
      sfrxUSD: emptyStringIfUndefined(sfrxUSDDeployment?.address),
    },
    walletAddresses: {
      governanceMultisig: user1,
    },
    dStables: {
      dUSD: {
        collaterals: [
          USDCDeployment?.address || ZeroAddress,
          USDSDeployment?.address || ZeroAddress,
          sUSDSDeployment?.address || ZeroAddress,
          frxUSDDeployment?.address || ZeroAddress,
          sfrxUSDDeployment?.address || ZeroAddress,
        ],
      },
      dS: {
        collaterals: [
          wSTokenDeployment?.address || ZeroAddress,
          wOSTokenDeployment?.address || ZeroAddress,
          stSTokenDeployment?.address || ZeroAddress,
        ],
      },
    },
    oracleAggregators: {
      USD: {
        hardDStablePeg: 10n ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS),
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        baseCurrency: ZeroAddress, // Note that USD is represented by the zero address, per Aave's convention
        api3OracleAssets: {
          // No thresholding, passthrough raw prices
          plainApi3OracleWrappers: {
            [wSTokenDeployment?.address || ""]: mockOracleDeployments["wS_USD"],
            [dSDeployment?.address || ""]: mockOracleDeployments["wS_USD"], // Peg dS to S
          },
          // Threshold the stablecoins
          api3OracleWrappersWithThresholding: {
            ...(USDCDeployment?.address && mockOracleDeployments["USDC_USD"]
              ? {
                  [USDCDeployment.address]: {
                    proxy: mockOracleDeployments["USDC_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(USDSDeployment?.address && mockOracleDeployments["USDS_USD"]
              ? {
                  [USDSDeployment.address]: {
                    proxy: mockOracleDeployments["USDS_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(frxUSDDeployment?.address && mockOracleDeployments["frxUSD_USD"]
              ? {
                  [frxUSDDeployment.address]: {
                    proxy: mockOracleDeployments["frxUSD_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
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
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Threshold for USDS/USD
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
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
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Threshold for frxUSD/USD
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            // Used by dLEND, and thus need USD feed
            ...(stSTokenDeployment?.address
              ? {
                  [stSTokenDeployment.address]: {
                    feedAsset: stSTokenDeployment.address,
                    proxy1: mockOracleDeployments["stS_S"],
                    proxy2: mockOracleDeployments["wS_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: 0n,
                    fixedPriceInBase2: 0n,
                  },
                }
              : {}),
            // Used by dLEND, and thus need USD feed
            ...(wOSTokenDeployment?.address
              ? {
                  [wOSTokenDeployment.address]: {
                    feedAsset: wOSTokenDeployment.address,
                    proxy1: mockOracleDeployments["wOS_S"],
                    proxy2: mockOracleDeployments["wS_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: 0n,
                    fixedPriceInBase2: 0n,
                  },
                }
              : {}),
          },
        },
      },
      S: {
        hardDStablePeg: 10n ** 18n, // wS has 18 decimals
        priceDecimals: 18, // wS has 18 decimals
        baseCurrency: wSTokenDeployment?.address || "", // We use wS to represent S since S is not ERC20
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
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {
            // Entries removed from here, as they belong in the USD config section
          },
        },
      },
    },
    dLend: {
      providerID: 1, // Arbitrary as long as we don't repeat
      flashLoanPremium: {
        total: 0.0005e4, // 0.05%
        protocol: 0.0004e4, // 0.04%
      },
      rateStrategies: [
        rateStrategyHighLiquidityVolatile,
        rateStrategyMediumLiquidityVolatile,
        rateStrategyHighLiquidityStable,
        rateStrategyMediumLiquidityStable,
      ],
      reservesConfig: {
        dUSD: strategyDStable,
        dS: strategyDStable,
        stS: strategyYieldBearingStablecoin,
        sfrxUSD: strategyYieldBearingStablecoin,
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
  return value || "";
}
