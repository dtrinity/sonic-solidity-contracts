import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import {
  DS_TOKEN_ID,
  DUSD_TOKEN_ID,
  INCENTIVES_PROXY_ID,
} from "../../typescript/deploy-ids";
import {
  ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  ORACLE_AGGREGATOR_PRICE_DECIMALS,
} from "../../typescript/oracle_aggregator/constants";
import { fetchTokenInfo } from "../../typescript/token/utils";
import {
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
  rateStrategyMediumLiquidityStable,
  rateStrategyMediumLiquidityVolatile,
} from "../dlend/interest-rate-strategies";
import {
  strategyDS,
  strategyDUSD,
  strategyPTaUSDC,
  strategyPTwstkscUSD,
  strategyscETH,
  strategySfrxUSD,
  strategyStS,
  strategyWETH,
  strategywOS,
  strategywstkscETH,
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
  const WETHAddress = "0x50c42dEAcD8Fc9773493ED674b675bE577f2634b";
  const scETHAddress = "0x3bcE5CB273F0F148010BbEa2470e7b5df84C7812";
  const wstkscETHAddress = "0xE8a41c62BB4d5863C6eadC96792cFE90A1f37C47";
  const ptaUSDCAddress = "0x930441Aa7Ab17654dF5663781CA0C02CC17e6643";
  const ptwstkscUSDAddress = "0x0Fb682C9692AddCc1769f4D4d938c54420D54fA3";
  const wOSAddress = "0x9F0dF7799f6FDAd409300080cfF680f5A23df4b1";
  const osAddress = "0xb1e25689D55734FD3ffFc939c4C3Eb52DFf8A794";

  const odoRouterV2Address = "0xaC041Df48dF9791B0654f1Dbbf2CC8450C5f2e9D"; // OdoRouterV2

  const governanceSafeMultisig = "0xE83c188a7BE46B90715C757A06cF917175f30262";

  // Safe configuration for governance multisig
  const safeOwners = [
    "0xDC672ba6e55B71b39FA5423D42B88E7aDF9d24A4",
    "0x4B58fF1AAE6AdD7465A5584eBCaeb876ec8f21FD",
    "0x9E0c8376940aBE845A89b7304147a95c72644f59",
  ];
  const safeThreshold = 2; // 2 of 3 multisig

  // Fetch deployed dLend StaticATokenLM wrapper, aToken and RewardsController (may be undefined prior to deployment)
  const dLendATokenWrapperDUSDDeployment = await _hre.deployments.getOrNull(
    "dLend_ATokenWrapper_dUSD",
  );
  const rewardsControllerDeployment =
    await _hre.deployments.getOrNull(INCENTIVES_PROXY_ID);
  const aTokenDUSDDeployment = await _hre.deployments.getOrNull("dLEND-dUSD");

  // Fetch dUSD token decimals from the contract if deployed
  let dUSDDecimals = 0;

  if (dUSDDeployment?.address) {
    const dUSDTokenInfo = await fetchTokenInfo(_hre, dUSDDeployment.address);
    dUSDDecimals = dUSDTokenInfo.decimals;

    if (dUSDDecimals < 1) {
      throw Error("dUSD token decimals must be greater than 0");
    }
  }

  return {
    safeConfig: {
      safeAddress: governanceSafeMultisig,
      owners: safeOwners,
      threshold: safeThreshold,
      chainId: 146, // Sonic mainnet chain ID
      rpcUrl: "https://rpc.sonic.fantom.network",
      // Temporary test: point to Ethereum mainnet Safe Transaction Service
      txServiceUrl: "https://safe-transaction-mainnet.safe.global",
    },
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
      WETH: WETHAddress,
      scETH: scETHAddress,
      wstkscETH: wstkscETHAddress,
      PTaUSDC: ptaUSDCAddress,
      PTwstkscUSD: ptwstkscUSDAddress,
      wOS: wOSAddress,
      OS: osAddress,
    },
    walletAddresses: {
      governanceMultisig: governanceSafeMultisig, // Created via Safe
      incentivesVault: "0x4B4B5cC616be4cd1947B93f2304d36b3e80D3ef6", // Incentives Safe address
    },
    pendle: {
      ptYtLpOracleAddress: "0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2", // Universal Pendle PT/YT/LP Oracle address
      ptTokens: [
        {
          name: "PT-aUSDC-14AUG2025",
          ptToken: "0x930441Aa7Ab17654dF5663781CA0C02CC17e6643",
          market: "0x3f5ea53d1160177445b1898afbb16da111182418",
          oracleType: "PT_TO_ASSET", // Quote price of USDC directly
          twapDuration: 900,
        },
        {
          name: "PT-wstkscUSD-18DEC2025",
          ptToken: "0x0Fb682C9692AddCc1769f4D4d938c54420D54fA3",
          market: "0x004f76045b42ef3e89814b12b37e69da19c8a212",
          oracleType: "PT_TO_ASSET", // Quote price of scUSD directly
          twapDuration: 900,
        },
      ],
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
        initialFeeReceiver: governanceSafeMultisig, // governanceMultisig
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Stablecoins: 0.4%
          [frxUSDAddress]: 0.4 * ONE_PERCENT_BPS,
          [USDCeAddress]: 0.4 * ONE_PERCENT_BPS,
          [scUSDAddress]: 0.4 * ONE_PERCENT_BPS,
          // Yield bearing stablecoins: 0.5%
          [sfrxUSDAddress]: 0.5 * ONE_PERCENT_BPS,
          [wstkscUSDAddress]: 0.5 * ONE_PERCENT_BPS,
        },
      },
      dS: {
        collaterals: [wSAddress, stSAddress],
        initialFeeReceiver: governanceSafeMultisig, // governanceMultisig
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Stablecoins: 0.4%
          [wSAddress]: 0.4 * ONE_PERCENT_BPS,
          // Yield bearing stablecoins: 0.5%
          [stSAddress]: 0.5 * ONE_PERCENT_BPS,
        },
      },
    },
    dLoop: {
      dUSDAddress: dUSDDeployment?.address || "",
      coreVaults: {
        "3x_sfrxUSD_dUSD": {
          // TODO: ALL dLOOP values are for QA ONLY. Reset them before mainnet
          venue: "dlend",
          name: "dLOOP 3X sfrxUSD dLEND",
          symbol: "3X-sfrxUSD",
          underlyingAsset: sfrxUSDAddress,
          dStable: dUSDDeployment?.address || "",
          targetLeverageBps: 300 * ONE_PERCENT_BPS, // 300% leverage, meaning 3x leverage
          lowerBoundTargetLeverageBps: 200 * ONE_PERCENT_BPS, // 200% leverage, meaning 2x leverage
          upperBoundTargetLeverageBps: 400 * ONE_PERCENT_BPS, // 400% leverage, meaning 4x leverage
          maxSubsidyBps: 2 * ONE_PERCENT_BPS, // 2% subsidy
          minDeviationBps: 2 * ONE_PERCENT_BPS, // 2% deviation
          withdrawalFeeBps: 0.4 * ONE_PERCENT_BPS, // 0.4% withdrawal fee
          extraParams: {
            targetStaticATokenWrapper:
              dLendATokenWrapperDUSDDeployment?.address,
            treasury: governanceSafeMultisig,
            maxTreasuryFeeBps: "1000",
            initialTreasuryFeeBps: "500",
            initialExchangeThreshold: 1n * 10n ** BigInt(dUSDDecimals), // TODO: 1 dStable token (fetched from contract decimals), for QA ONLY
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
      decreaseLeverage: {
        odos: {
          router: odoRouterV2Address,
        },
      },
      increaseLeverage: {
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
            [WETHAddress]: {
              feed: "0x824364077993847f71293B24ccA8567c00c2de11", // WETH/USD Chainlink price feed
              lowerThreshold: 0n, // No thresholding
              fixedPrice: 0n,
            },
            [scETHAddress]: {
              feed: "0x19A95E6203A0611b6be322c25b63Ec989fFE15c1", // scETH/USD Chainlink price feed
              lowerThreshold: 0n, // No thresholding
              fixedPrice: 0n,
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
            [wstkscETHAddress]: {
              feedAsset: wstkscETHAddress,
              feed1: "0xaA0eA5aa28dCB4280d0469167Bb8Bf99F51427D3", // Our own ChainlinkDecimalConverter which wraps the wstkscETH/stkscETH Chainlink feed and converts 18 -> 8 decimals
              feed2: "0x19A95E6203A0611b6be322c25b63Ec989fFE15c1", // scETH/USD Chainlink price feed
              lowerThresholdInBase1: 0n, // No thresholding
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: 0n, // No thresholding
              fixedPriceInBase2: 0n,
            },
            [ptaUSDCAddress]: {
              feedAsset: ptaUSDCAddress,
              feed1: "0xc65F6b9dBAFa2A9243CeceDbf80EE9a79d6ADf09", // Our own ChainlinkDecimalConverter which wraps the PT-aUSDC/USDC Pendle Chainlink feed and converts 18 -> 8 decimals
              feed2: "0x3587a73AA02519335A8a6053a97657BECe0bC2Cc", // USDC/USD Redstone price feed
              lowerThresholdInBase1: 0n, // No thresholding
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Only threshold USDC/USD
              fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [ptwstkscUSDAddress]: {
              feedAsset: ptwstkscUSDAddress,
              feed1: "0x2EfEb81d6A0E5638bfe917C6cFCeb42989058d08", // Our own ChainlinkDecimalConverter which wraps the PT-wstkscUSD/scUSD Pendle Chainlink feed and converts 18 -> 8 decimals
              feed2: "0xACE5e348a341a740004304c2c228Af1A4581920F", // scUSD/USD Chainlink price feed
              lowerThresholdInBase1: 0n, // No thresholding
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Only threshold scUSD/USD
              fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [wOSAddress]: {
              feedAsset: wOSAddress,
              feed1: "0x19E84B1f41d1Eb2ff22baC55797bD767558585De", // Our own ChainlinkDecimalConverter which wraps the wOS/OS Chainlink feed and converts 18 -> 8 decimals
              feed2: "0xF6819756b86678dEd7A0aECD983697c4F7D42bbc", // Our own ChainlinkCompositeAggregator which composes OS/S and S/USD
              lowerThresholdInBase1: 0n, // No thresholding
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: 0n, // No thresholding
              fixedPriceInBase2: 0n,
            },
          },
        },
        chainlinkCompositeAggregator: {
          [osAddress]: {
            name: "OS_S_USD",
            feedAsset: osAddress,
            sourceFeed1: "0x125629732C21A403Ae1eFf159467971ee01470a6", // Our own ChainlinkDecimalConverter which wraps the OS/S Chainlink feed and converts 18 -> 8 decimals
            sourceFeed2: "0xc76dFb89fF298145b417d221B2c747d84952e01d", // S/USD Chainlink price feed
            lowerThresholdInBase1: 0n, // No thresholding for OS/S
            fixedPriceInBase1: 0n,
            lowerThresholdInBase2: 0n, // No thresholding for S/USD
            fixedPriceInBase2: 0n,
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
        WETH: strategyWETH,
        scETH: strategyscETH,
        wstkscETH: strategywstkscETH,
        PTaUSDC: strategyPTaUSDC,
        PTwstkscUSD: strategyPTwstkscUSD,
        wOS: strategywOS,
      },
    },
    odos: {
      router: odoRouterV2Address,
    },
    dStake: {
      sdUSD: {
        dStable: emptyStringIfUndefined(dUSDDeployment?.address),
        name: "Staked dUSD",
        symbol: "sdUSD",
        initialAdmin: governanceSafeMultisig,
        initialFeeManager: governanceSafeMultisig,
        initialWithdrawalFeeBps: 0.1 * ONE_PERCENT_BPS, // 0.1%
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
        collateralVault: "DStakeCollateralVault_sdUSD", // Keep in sync with deploy ID constants
        collateralExchangers: [governanceSafeMultisig],
        dLendRewardManager: {
          managedVaultAsset: emptyStringIfUndefined(
            dLendATokenWrapperDUSDDeployment?.address,
          ), // StaticATokenLM wrapper
          dLendAssetToClaimFor: emptyStringIfUndefined(
            aTokenDUSDDeployment?.address,
          ), // dLEND aToken for dUSD
          dLendRewardsController: emptyStringIfUndefined(
            rewardsControllerDeployment?.address,
          ), // RewardsController proxy
          treasury: governanceSafeMultisig,
          maxTreasuryFeeBps: 20 * ONE_PERCENT_BPS, // 20%
          initialTreasuryFeeBps: 0 * ONE_PERCENT_BPS, // 0%
          initialExchangeThreshold: 100n * 10n ** BigInt(dUSDDecimals), // 100 sdUSD
        },
      },
    },
    // Not launching dBOOST yet, so keep disabled for now
    // vesting: {
    //   name: "dBOOST sdUSD Season 1",
    //   symbol: "sdUSD-S1",
    //   dstakeToken: emptyStringIfUndefined(sdUSDDeployment?.address),
    //   vestingPeriod: 180 * 24 * 60 * 60, // 6 months
    //   maxTotalSupply: _hre.ethers.parseUnits("20000000", 18).toString(), // 20M tokens
    //   initialOwner: governanceSafeMultisig,
    //   minDepositThreshold: _hre.ethers.parseUnits("250000", 18).toString(), // 250k tokens
    // },
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
