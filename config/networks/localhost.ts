import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
  DS_TOKEN_ID,
  DUSD_TOKEN_ID,
  INCENTIVES_PROXY_ID,
} from "../../typescript/deploy-ids";
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
  strategyDS,
  strategyDUSD,
  strategySfrxUSD,
  strategyStS,
  strategyWstkscUSD,
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
  const OSTokenDeployment = await _hre.deployments.getOrNull("OS");
  const wOSTokenDeployment = await _hre.deployments.getOrNull("wOS");
  const stSTokenDeployment = await _hre.deployments.getOrNull("stS");
  const scUSDDeployment = await _hre.deployments.getOrNull("scUSD");
  const wstkscUSDDeployment = await _hre.deployments.getOrNull("wstkscUSD");

  // Fetch deployed dLend StaticATokenLM wrappers
  const dLendATokenWrapperDUSDDeployment = await _hre.deployments.getOrNull(
    "dLend_ATokenWrapper_dUSD",
  );
  const dLendATokenWrapperDSDeployment = await _hre.deployments.getOrNull(
    "dLend_ATokenWrapper_dS",
  );

  // Fetch deployed dLend RewardsController
  const rewardsControllerDeployment =
    await _hre.deployments.getOrNull(INCENTIVES_PROXY_ID);

  // Fetch deployed dLend aTokens
  const aTokenDUSDDeployment = await _hre.deployments.getOrNull("dLEND-dUSD");

  // Get mock oracle deployments
  const mockOracleNameToAddress: Record<string, string> = {};

  // REFACTOR: Load addresses directly using getOrNull
  const mockOracleAddressesDeployment = await _hre.deployments.getOrNull(
    "MockOracleNameToAddress",
  );

  if (mockOracleAddressesDeployment?.linkedData) {
    Object.assign(
      mockOracleNameToAddress,
      mockOracleAddressesDeployment.linkedData,
    );
  } else {
    console.warn(
      "WARN: MockOracleNameToAddress deployment not found or has no linkedData. Oracle addresses might be incomplete.",
    );
  }

  // Get the named accounts
  const { user1 } = await _hre.getNamedAccounts();

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
        OS: {
          name: "Origin S",
          address: OSTokenDeployment?.address,
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
      sfrxUSD: emptyStringIfUndefined(sfrxUSDDeployment?.address), // Used by dLEND
      stS: emptyStringIfUndefined(stSTokenDeployment?.address), // Used by dLEND
      wstkscUSD: emptyStringIfUndefined(wstkscUSDDeployment?.address), // Used by dLEND
      USDC: emptyStringIfUndefined(USDCDeployment?.address), // Used by dPOOL
      USDS: emptyStringIfUndefined(USDSDeployment?.address), // Used by dPOOL
      frxUSD: emptyStringIfUndefined(frxUSDDeployment?.address), // Used by dPOOL
    },
    walletAddresses: {
      governanceMultisig: user1,
      incentivesVault: user1,
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
        hardDStablePeg: 1n * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        baseCurrency: ZeroAddress,
        api3OracleAssets: {
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {
            [wSTokenDeployment?.address || ""]:
              mockOracleNameToAddress["wS_USD"],
            [dSDeployment?.address || ""]: mockOracleNameToAddress["wS_USD"], // Peg dS to S
          },
          redstoneOracleWrappersWithThresholding: {
            ...(USDCDeployment?.address && mockOracleNameToAddress["USDC_USD"]
              ? {
                  [USDCDeployment.address]: {
                    feed: mockOracleNameToAddress["USDC_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(USDSDeployment?.address && mockOracleNameToAddress["USDS_USD"]
              ? {
                  [USDSDeployment.address]: {
                    feed: mockOracleNameToAddress["USDS_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(frxUSDDeployment?.address &&
            mockOracleNameToAddress["frxUSD_USD"]
              ? {
                  [frxUSDDeployment.address]: {
                    feed: mockOracleNameToAddress["frxUSD_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
          },
          compositeRedstoneOracleWrappersWithThresholding: {
            ...(sUSDSDeployment?.address &&
            mockOracleNameToAddress["sUSDS_USDS"] &&
            mockOracleNameToAddress["USDS_USD"]
              ? {
                  [sUSDSDeployment.address]: {
                    feedAsset: sUSDSDeployment.address,
                    feed1: mockOracleNameToAddress["sUSDS_USDS"],
                    feed2: mockOracleNameToAddress["USDS_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(sfrxUSDDeployment?.address &&
            mockOracleNameToAddress["sfrxUSD_frxUSD"] &&
            mockOracleNameToAddress["frxUSD_USD"]
              ? {
                  [sfrxUSDDeployment.address]: {
                    feedAsset: sfrxUSDDeployment.address,
                    feed1: mockOracleNameToAddress["sfrxUSD_frxUSD"],
                    feed2: mockOracleNameToAddress["frxUSD_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
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
            ...(stSTokenDeployment?.address
              ? {
                  [stSTokenDeployment.address]: {
                    feedAsset: stSTokenDeployment.address,
                    feed1: mockOracleNameToAddress["stS_S"],
                    feed2: mockOracleNameToAddress["wS_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: 0n,
                    fixedPriceInBase2: 0n,
                  },
                }
              : {}),
            ...(wOSTokenDeployment?.address &&
            mockOracleNameToAddress["wOS_S"] &&
            mockOracleNameToAddress["wS_USD"]
              ? {
                  [wOSTokenDeployment.address]: {
                    feedAsset: wOSTokenDeployment.address,
                    feed1: mockOracleNameToAddress["wOS_OS"],
                    feed2: mockOracleNameToAddress["OS_S"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
          },
        },
      },
      S: {
        hardDStablePeg: 1n * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        baseCurrency: wSTokenDeployment?.address || ZeroAddress, // Base currency is S
        api3OracleAssets: {
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {
            [stSTokenDeployment?.address || ""]:
              mockOracleNameToAddress["stS_S"],
          },
          redstoneOracleWrappersWithThresholding: {
            ...(OSTokenDeployment?.address && mockOracleNameToAddress["OS_S"]
              ? {
                  [OSTokenDeployment.address]: {
                    feed: mockOracleNameToAddress["OS_S"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // 1.0 in S terms
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // 1.0 in S terms
                  },
                }
              : {}),
          },
          compositeRedstoneOracleWrappersWithThresholding: {
            ...(wOSTokenDeployment?.address &&
            mockOracleNameToAddress["wOS_OS"] &&
            mockOracleNameToAddress["OS_S"]
              ? {
                  [wOSTokenDeployment.address]: {
                    feedAsset: wOSTokenDeployment.address,
                    feed1: mockOracleNameToAddress["wOS_OS"],
                    feed2: mockOracleNameToAddress["OS_S"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
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
        dUSD: strategyDUSD,
        dS: strategyDS,
        stS: strategyStS,
        sfrxUSD: strategySfrxUSD,
        wstkscUSD: strategyWstkscUSD,
      },
    },
    odos: {
      router: "", // Odos doesn't work on localhost
    },
    dStake: {
      sdUSD: {
        dStable: emptyStringIfUndefined(dUSDDeployment?.address),
        name: "Staked dUSD",
        symbol: "sdUSD",
        initialAdmin: user1,
        initialFeeManager: user1,
        initialWithdrawalFeeBps: 10,
        adapters: [
          {
            vaultAsset: emptyStringIfUndefined(
              dLendATokenWrapperDUSDDeployment?.address,
            ),
            adapterContract: "WrappedDLendConversionAdapter",
          },
        ],
        defaultDepositVaultAsset: emptyStringIfUndefined(
          dLendATokenWrapperDUSDDeployment?.address,
        ),
        collateralVault: "DStakeCollateralVault_sdUSD",
        collateralExchangers: [user1],
        dLendRewardManager: {
          managedVaultAsset: emptyStringIfUndefined(
            dLendATokenWrapperDUSDDeployment?.address,
          ), // This should be the deployed StaticATokenLM address for dUSD
          dLendAssetToClaimFor: emptyStringIfUndefined(
            aTokenDUSDDeployment?.address,
          ), // Use the deployed dLEND-dUSD aToken address
          dLendRewardsController: emptyStringIfUndefined(
            rewardsControllerDeployment?.address,
          ), // This will be fetched after dLend incentives deployment
          treasury: user1, // Or a dedicated treasury address
          maxTreasuryFeeBps: 500, // Example: 5%
          initialTreasuryFeeBps: 100, // Example: 1%
          initialExchangeThreshold: 1e6, // Example: 1 dStable (adjust based on dStable decimals)
          initialAdmin: user1, // Optional: specific admin for this reward manager
          initialRewardsManager: user1, // Optional: specific rewards manager role holder
        },
      },
      sdS: {
        dStable: emptyStringIfUndefined(dSDeployment?.address),
        name: "Staked dS",
        symbol: "sdS",
        initialAdmin: user1,
        initialFeeManager: user1,
        initialWithdrawalFeeBps: 10,
        adapters: [
          {
            vaultAsset: emptyStringIfUndefined(
              dLendATokenWrapperDSDeployment?.address,
            ),
            adapterContract: "WrappedDLendConversionAdapter",
          },
        ],
        defaultDepositVaultAsset: emptyStringIfUndefined(
          dLendATokenWrapperDSDeployment?.address,
        ),
        collateralVault: "DStakeCollateralVault_sdS",
        collateralExchangers: [user1],
        dLendRewardManager: {
          managedVaultAsset: emptyStringIfUndefined(
            dLendATokenWrapperDSDeployment?.address,
          ), // This should be the deployed StaticATokenLM address for dS
          dLendAssetToClaimFor: emptyStringIfUndefined(dSDeployment?.address), // Use the dS underlying asset address as a placeholder
          dLendRewardsController: emptyStringIfUndefined(
            rewardsControllerDeployment?.address,
          ), // This will be fetched after dLend incentives deployment
          treasury: user1, // Or a dedicated treasury address
          maxTreasuryFeeBps: 500, // Example: 5%
          initialTreasuryFeeBps: 100, // Example: 1%
          initialExchangeThreshold: 1e6, // Example: 1 dStable (adjust based on dStable decimals)
          initialAdmin: user1, // Optional: specific admin for this reward manager
          initialRewardsManager: user1, // Optional: specific rewards manager role holder
        },
      },
    },
    dPool: {
      // Note: In localhost, pool should be the deployment name
      // In testnet/mainnet, pool should be the actual pool address
      // Example for mainnet: pool: "0xA5407eAE9Ba41422680e2e00537571bcC53efBfD"
      // eslint-disable-next-line camelcase -- Ignore for config
      USDC_USDS_Curve: {
        baseAsset: "USDC", // Base asset for valuation (smart contract will auto-determine index)
        name: "dPOOL USDC/USDS",
        symbol: "USDC-USDS_Curve",
        initialAdmin: user1,
        initialSlippageBps: 100, // 1% max slippage for periphery
        pool: "USDC_USDS_CurvePool", // Deployment name (localhost) or address (testnet/mainnet)
      },
      // eslint-disable-next-line camelcase -- Ignore for config
      frxUSD_USDC_Curve: {
        baseAsset: "frxUSD", // Base asset for valuation (smart contract will auto-determine index)
        name: "dPOOL frxUSD/USDC",
        symbol: "frxUSD-USDC_Curve",
        initialAdmin: user1,
        initialSlippageBps: 100, // 1% max slippage for periphery
        pool: "frxUSD_USDC_CurvePool", // Deployment name (localhost) or address (testnet/mainnet)
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
