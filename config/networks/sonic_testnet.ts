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

const wSAddress = "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38";

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(
  _hre: HardhatRuntimeEnvironment
): Promise<Config> {
  // Token info will only be populated after their deployment
  const dUSDDeployment = await _hre.deployments.getOrNull(DUSD_TOKEN_ID);
  const dSDeployment = await _hre.deployments.getOrNull(DS_TOKEN_ID);
  const USDCDeployment = await _hre.deployments.getOrNull("USDC");
  const USDSDeployment = await _hre.deployments.getOrNull("USDS");
  const sUSDSDeployment = await _hre.deployments.getOrNull("sUSDS");
  const frxUSDDeployment = await _hre.deployments.getOrNull("frxUSD");
  const sfrxUSDDeployment = await _hre.deployments.getOrNull("sfrxUSD");
  const wOSTokenDeployment = await _hre.deployments.getOrNull("wOS");
  const stSTokenDeployment = await _hre.deployments.getOrNull("stS");
  const wstkscUSDDeployment = await _hre.deployments.getOrNull("wstkscUSD");
  // Get mock oracle deployments
  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleAddressesDeployment = await _hre.deployments.getOrNull(
    "MockOracleNameToAddress"
  );

  if (mockOracleAddressesDeployment?.linkedData) {
    Object.assign(
      mockOracleNameToAddress,
      mockOracleAddressesDeployment.linkedData
    );
  } else {
    console.warn(
      "WARN: MockOracleNameToAddress deployment not found or has no linkedData. Oracle configuration might be incomplete."
    );
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
        wOS: {
          name: "Wrapped Origin S",
          address: wOSTokenDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        stS: {
          name: "Beets Staked S",
          address: stSTokenDeployment?.address,
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
      wS: wSAddress,
      sfrxUSD: emptyStringIfUndefined(sfrxUSDDeployment?.address), // Used by dLEND
      stS: emptyStringIfUndefined(stSTokenDeployment?.address), // Used by dLEND
      wstkscUSD: emptyStringIfUndefined(wstkscUSDDeployment?.address), // Used by dLEND
    },
    walletAddresses: {
      governanceMultisig: "0xd2f775Ff2cD41bfe43C7A8c016eD10393553fe44", // Actually just the testnet deployer address
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
          wSAddress,
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
          // All configurations moved to redstoneOracleAssets
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          // Moved from API3
          plainRedstoneOracleWrappers: {
            [wSAddress]: mockOracleNameToAddress["wS_USD"],
            [dSDeployment?.address || ""]: mockOracleNameToAddress["wS_USD"],
          },
          // Moved from API3
          redstoneOracleWrappersWithThresholding: {
            ...(USDCDeployment?.address && mockOracleNameToAddress["USDC_USD"]
              ? {
                  [USDCDeployment.address]: {
                    feed: mockOracleNameToAddress["USDC_USD"], // Changed from proxy
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(USDSDeployment?.address && mockOracleNameToAddress["USDS_USD"]
              ? {
                  [USDSDeployment.address]: {
                    feed: mockOracleNameToAddress["USDS_USD"], // Changed from proxy
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(frxUSDDeployment?.address &&
            mockOracleNameToAddress["frxUSD_USD"]
              ? {
                  [frxUSDDeployment.address]: {
                    feed: mockOracleNameToAddress["frxUSD_USD"], // Changed from proxy
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
          },
          // Moved from API3
          compositeRedstoneOracleWrappersWithThresholding: {
            // sUSDS composite feed (sUSDS/USDS * USDS/USD)
            ...(sUSDSDeployment?.address &&
            mockOracleNameToAddress["sUSDS_USDS"] &&
            mockOracleNameToAddress["USDS_USD"]
              ? {
                  [sUSDSDeployment.address]: {
                    feedAsset: sUSDSDeployment.address,
                    feed1: mockOracleNameToAddress["sUSDS_USDS"], // Changed from proxy1
                    feed2: mockOracleNameToAddress["USDS_USD"], // Changed from proxy2
                    lowerThresholdInBase1: 0n, // No threshold for sUSDS/USDS
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Threshold for USDS/USD
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
                    feed1: mockOracleNameToAddress["sfrxUSD_frxUSD"], // Changed from proxy1
                    feed2: mockOracleNameToAddress["frxUSD_USD"], // Changed from proxy2
                    lowerThresholdInBase1: 0n, // No threshold for sfrxUSD/frxUSD
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Threshold for frxUSD/USD
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(wstkscUSDDeployment?.address &&
            mockOracleNameToAddress["wstkscUSD_scUSD"] &&
            mockOracleNameToAddress["scUSD_USD"]
              ? {
                  [wstkscUSDDeployment.address]: {
                    feedAsset: wstkscUSDDeployment.address,
                    feed1: mockOracleNameToAddress["wstkscUSD_scUSD"],
                    feed2: mockOracleNameToAddress["scUSD_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: 0n,
                    fixedPriceInBase2: 0n,
                  },
                }
              : {}),
            // Used by dLEND, and thus need USD feed
            ...(stSTokenDeployment?.address
              ? {
                  [stSTokenDeployment.address]: {
                    feedAsset: stSTokenDeployment.address,
                    feed1: mockOracleNameToAddress["stS_S"], // Changed from proxy1
                    feed2: mockOracleNameToAddress["wS_USD"], // Changed from proxy2
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
                    feed1: mockOracleNameToAddress["wOS_S"], // Changed from proxy1
                    feed2: mockOracleNameToAddress["wS_USD"], // Changed from proxy2
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
        baseCurrency: wSAddress, // We use wS to represent S since S is not ERC20
        api3OracleAssets: {
          // All configurations moved to redstoneOracleAssets
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          // Moved from API3
          plainRedstoneOracleWrappers: {
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
            // Add Redstone feeds here when available
          },
          // Moved from API3 (empty)
          redstoneOracleWrappersWithThresholding: {
            // Add Redstone feeds with thresholding here when available
          },
          // Moved from API3 (empty)
          compositeRedstoneOracleWrappersWithThresholding: {
            // Add composite Redstone feeds here when available
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
        wstkscUSD: strategyYieldBearingStablecoin,
      },
    },
    odos: {
      router: "", // Odos doesn't work on sonic testnet
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
