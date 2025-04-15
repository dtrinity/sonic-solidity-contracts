import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { OracleProvider } from "../../deploy-mocks/02_mock_oracle_setup";
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
  const scUSDDeployment = await _hre.deployments.getOrNull("scUSD");
  const wstkscUSDDeployment = await _hre.deployments.getOrNull("wstkscUSD");

  // Get mock oracle deployments
  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleNameToProvider: Record<string, OracleProvider> = {};
  const mockOracleDeploymentsAll = await _hre.deployments.all();

  // Get the named accounts
  const { user1 } = await _hre.getNamedAccounts();

  for (const [name, deployment] of Object.entries(mockOracleDeploymentsAll)) {
    if (name === "MockOracleNameToAddress") {
      Object.assign(mockOracleNameToAddress, deployment.linkedData);
    } else if (name === "MockOracleNameToProvider") {
      Object.assign(mockOracleNameToProvider, deployment.linkedData);
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
        scUSD: {
          name: "Sonic USD",
          address: scUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        wstkscUSD: {
          name: "Wrapped Staked Sonic USD",
          address: wstkscUSDDeployment?.address,
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
        baseCurrency: ZeroAddress,
        api3OracleAssets: {
          // No thresholding, passthrough raw prices
          plainApi3OracleWrappers: {
            [wSTokenDeployment?.address || ""]:
              mockOracleNameToAddress["wS_USD"],
            [dSDeployment?.address || ""]: mockOracleNameToAddress["wS_USD"], // Peg dS to S
          },
          // Threshold the stablecoins
          api3OracleWrappersWithThresholding: {
            ...(USDCDeployment?.address && mockOracleNameToAddress["USDC_USD"]
              ? {
                  [USDCDeployment.address]: {
                    proxy: mockOracleNameToAddress["USDC_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(USDSDeployment?.address && mockOracleNameToAddress["USDS_USD"]
              ? {
                  [USDSDeployment.address]: {
                    proxy: mockOracleNameToAddress["USDS_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(frxUSDDeployment?.address &&
            mockOracleNameToAddress["frxUSD_USD"]
              ? {
                  [frxUSDDeployment.address]: {
                    proxy: mockOracleNameToAddress["frxUSD_USD"],
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
            mockOracleNameToAddress["sUSDS_USDS"] &&
            mockOracleNameToAddress["USDS_USD"]
              ? {
                  [sUSDSDeployment.address]: {
                    feedAsset: sUSDSDeployment.address,
                    proxy1: mockOracleNameToAddress["sUSDS_USDS"],
                    proxy2: mockOracleNameToAddress["USDS_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            // sfrxUSD composite feed (sfrxUSD/frxUSD * frxUSD/USD)
            ...(sfrxUSDDeployment?.address &&
            mockOracleNameToAddress["sfrxUSD_frxUSD"] &&
            mockOracleNameToAddress["frxUSD_USD"]
              ? {
                  [sfrxUSDDeployment.address]: {
                    feedAsset: sfrxUSDDeployment.address,
                    proxy1: mockOracleNameToAddress["sfrxUSD_frxUSD"],
                    proxy2: mockOracleNameToAddress["frxUSD_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            // Used by dLEND, and thus need USD feed
            ...(stSTokenDeployment?.address
              ? {
                  [stSTokenDeployment.address]: {
                    feedAsset: stSTokenDeployment.address,
                    proxy1: mockOracleNameToAddress["stS_S"],
                    proxy2: mockOracleNameToAddress["wS_USD"],
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
                    proxy1: mockOracleNameToAddress["wOS_S"],
                    proxy2: mockOracleNameToAddress["wS_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: 0n,
                    fixedPriceInBase2: 0n,
                  },
                }
              : {}),
          },
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {
            [wstkscUSDDeployment?.address || ""]:
              mockOracleNameToAddress["wstkscUSD_scUSD"],
          },
          redstoneOracleWrappersWithThresholding: {
            [scUSDDeployment?.address || ""]: {
              feed: mockOracleNameToAddress["scUSD_USD"],
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
          },
          compositeRedstoneOracleWrappersWithThresholding: {
            [wstkscUSDDeployment?.address || ""]: {
              feedAsset: wstkscUSDDeployment?.address || "",
              feed1: mockOracleNameToAddress["wstkscUSD_scUSD"],
              feed2: mockOracleNameToAddress["scUSD_USD"],
              lowerThresholdInBase1: 0n,
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
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
            ...(wOSTokenDeployment?.address && mockOracleNameToAddress["wOS_S"]
              ? {
                  [wOSTokenDeployment.address]:
                    mockOracleNameToAddress["wOS_S"],
                }
              : {}),
            ...(stSTokenDeployment?.address && mockOracleNameToAddress["stS_S"]
              ? {
                  [stSTokenDeployment.address]:
                    mockOracleNameToAddress["stS_S"],
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
    odos: {
      router: "", // Odos doesn't work on localhost
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
