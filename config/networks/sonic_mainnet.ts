import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
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
  strategyDS,
  strategyDUSD,
  strategySfrxUSD,
  strategyStS,
  strategyWstkscUSD,
  // strategyWstkscUSD,
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
  const dUSDDeployment = await _hre.deployments.getOrNull(DUSD_TOKEN_ID);
  const dSDeployment = await _hre.deployments.getOrNull(DS_TOKEN_ID);
  const wSAddress = "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38";
  const stSAddress = "0xE5DA20F15420aD15DE0fa650600aFc998bbE3955";
  const frxUSDAddress = "0x80Eede496655FB9047dd39d9f418d5483ED600df";
  const sfrxUSDAddress = "0x5Bff88cA1442c2496f7E475E9e7786383Bc070c0";
  const wstkscUSDAddress = "0x9fb76f7ce5FCeAA2C42887ff441D46095E494206";
  const USDCeAddress = "0x29219dd400f2Bf60E5a23d13Be72B486D4038894";
  const scUSDAddress = "0xd3DCe716f3eF535C5Ff8d041c1A41C3bd89b97aE";

  const odoRouterV2Address = "0xaC041Df48dF9791B0654f1Dbbf2CC8450C5f2e9D"; // OdoRouterV2

  // const dLendATokenWrapperDUSDDeployment = await _hre.deployments.getOrNull(
  //   "dLend_ATokenWrapper_dUSD",
  // );

  const { feeTreasury } = await _hre.getNamedAccounts();

  if (!feeTreasury) {
    throw new Error("Fee treasury address not found");
  }

  return {
    tokenAddresses: {
      dUSD: emptyStringIfUndefined(dUSDDeployment?.address),
      dS: emptyStringIfUndefined(dSDeployment?.address),
      wS: wSAddress,
      stS: stSAddress,
      frxUSD: frxUSDAddress,
      sfrxUSD: sfrxUSDAddress,
      wstkscUSD: wstkscUSDAddress,
      USDCe: USDCeAddress,
      scUSD: scUSDAddress,
    },
    walletAddresses: {
      governanceMultisig: "0xE83c188a7BE46B90715C757A06cF917175f30262", // Created via Safe
      incentivesVault: "0x4B4B5cC616be4cd1947B93f2304d36b3e80D3ef6", // TODO: Add incentives vault address
    },
    dStables: {
      dUSD: {
        collaterals: [
          frxUSDAddress,
          sfrxUSDAddress,
          // wstkscUSDAddress,
          USDCeAddress,
          scUSDAddress,
        ],
      },
      dS: {
        collaterals: [wSAddress, stSAddress],
      },
    },
    dLoop: {
      dUSDAddress: dUSDDeployment?.address || "",
      coreVaults: {
        "3x_sFRAX_dUSD": {
          venue: "dlend",
          name: "Leveraged sFRAX-dUSD Vault",
          symbol: "FRAX-dUSD-3x",
          underlyingAsset: sfrxUSDAddress,
          dStable: dUSDDeployment?.address || "",
          targetLeverageBps: 300 * ONE_PERCENT_BPS, // 300% leverage, meaning 3x leverage
          lowerBoundTargetLeverageBps: 200 * ONE_PERCENT_BPS, // 200% leverage, meaning 2x leverage
          upperBoundTargetLeverageBps: 400 * ONE_PERCENT_BPS, // 400% leverage, meaning 4x leverage
          maxSubsidyBps: 2 * ONE_PERCENT_BPS, // 2% subsidy
          extraParams: {
            // targetStaticATokenWrapper:
            //   dLendATokenWrapperDUSDDeployment?.address,
            targetStaticATokenWrapper:
              "0x0000000000000000000000000000000000000000", // TODO: add real targetStaticATokenWrapper address
            exchangeAsset: dUSDDeployment?.address || "",
            treasury: feeTreasury,
            maxTreasuryFeeBps: "1000",
            initialTreasuryFeeBps: "500",
            initialExchangeThreshold: "100",
          },
        },
      },
      depositors: {
        odos: {
          router: odoRouterV2Address,
        },
      },
      redeemers: {
        odos: {
          router: odoRouterV2Address,
        },
      },
    },
    oracleAggregators: {
      USD: {
        baseCurrency: ZeroAddress, // Note that USD is represented by the zero address, per Aave's convention
        hardDStablePeg: 10n ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS),
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        api3OracleAssets: {
          plainApi3OracleWrappers: {
            [wSAddress]: "0xAf9647E1F86406BC38F42FE630E9Fa8CBcd59B19", // S/USD dTRINITY OEV
            [dSDeployment?.address || ""]:
              "0xAf9647E1F86406BC38F42FE630E9Fa8CBcd59B19", // S/USD dTRINITY OEV
          },
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {},
          redstoneOracleWrappersWithThresholding: {
            [frxUSDAddress]: {
              feed: "0xC3346631E0A9720582fB9CAbdBEA22BC2F57741b", // frxUSD/USD Redstone price feed
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [USDCeAddress]: {
              feed: "0x3587a73AA02519335A8a6053a97657BECe0bC2Cc", // USDC/USD Redstone price feed
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
          },
          compositeRedstoneOracleWrappersWithThresholding: {
            [sfrxUSDAddress]: {
              feedAsset: sfrxUSDAddress,
              feed1: "0xebE443E20ADf302B59419648c4dbA0c7299cf1A2", // sfrxUSD/frxUSD Redstone Fundamental feed
              feed2: "0xC3346631E0A9720582fB9CAbdBEA22BC2F57741b", // frxUSD/USD Redstone price feed
              lowerThresholdInBase1: 0n, // No thresholding
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Only threshold frxUSD/USD
              fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [scUSDAddress]: {
              feedAsset: scUSDAddress,
              feed1: "0xb81131B6368b3F0a83af09dB4E39Ac23DA96C2Db", // scUSD/USDC Redstone Fundamental feed
              feed2: "0x3587a73AA02519335A8a6053a97657BECe0bC2Cc", // USDC/USD Redstone price feed
              lowerThresholdInBase1: 0n, // No thresholding
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Only threshold scUSD/USD
              fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [stSAddress]: {
              feedAsset: stSAddress,
              feed1: "0x65d0F14f7809CdC4f90c3978c753C4671b6B815b", // stS/S Redstone Fundamental feed
              feed2: "0xa8a94Da411425634e3Ed6C331a32ab4fd774aa43", // S/USD Redstone price feed
              lowerThresholdInBase1: 0n, // No thresholding
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: 0n, // Do not threshold S/USD
              fixedPriceInBase2: 0n,
            },
            [wstkscUSDAddress]: {
              feedAsset: wstkscUSDAddress,
              feed1: "0x39EEB8955948B980d9ad09F92F95cdD980751ce1", // Our own ChainlinkDecimalConverter which wraps the wstkscUSD/stkscUSD Chainlink feed and converts 18 -> 8 decimals
              feed2: "0xACE5e348a341a740004304c2c228Af1A4581920F", // scUSD/USD Chainlink price feed
              lowerThresholdInBase1: 0n, // No thresholding
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Only threshold scUSD/USD
              fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
          },
        },
      },
      S: {
        hardDStablePeg: 10n ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS),
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        baseCurrency: wSAddress,
        api3OracleAssets: {
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {
            [stSAddress]: "0x65d0F14f7809CdC4f90c3978c753C4671b6B815b", // stS/S Redstone Fundamental feed
          },
          redstoneOracleWrappersWithThresholding: {},
          compositeRedstoneOracleWrappersWithThresholding: {},
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
      router: odoRouterV2Address,
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
