import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { DS_TOKEN_ID, DUSD_TOKEN_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { Config } from "../types";

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(
  _hre: HardhatRuntimeEnvironment
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
      governanceMultisig: "0xE83c188a7BE46B90715C757A06cF917175f30262",
    },
    dStables: {
      dUSD: {
        collaterals: [
          frxUSDAddress,
          sfrxUSDAddress,
          wstkscUSDAddress,
          USDCeAddress,
          scUSDAddress,
        ],
      },
      dS: {
        collaterals: [wSAddress, stSAddress],
      },
    },
    oracleAggregators: {
      USD: {
        baseCurrency: ZeroAddress, // Note that USD is represented by the zero address, per Aave's convention
        hardDStablePeg: 10n ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS),
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        api3OracleAssets: {
          // TODO don't forget to add ALL the dLEND markets, even the S ones!
          plainApi3OracleWrappers: {
            [wSAddress]: "0xAf9647E1F86406BC38F42FE630E9Fa8CBcd59B19", // S/USD dTRINITY OEV
            [stSAddress]: "", // S/USD dTRINITY OEV
            [frxUSDAddress]: "", // S/USD dTRINITY OEV
            [sfrxUSDAddress]: "", // S/USD dTRINITY OEV
            [wstkscUSDAddress]: "", // S/USD dTRINITY OEV
            [USDCeAddress]: "", // S/USD dTRINITY OEV
            [scUSDAddress]: "", // S/USD dTRINITY OEV
          },
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
          // TODO add stS/S feed
          // TODO add stS/USD feed
        },
      },
      // TODO add one for wS
    },
    dLend: {
      providerID: 1, // Arbitrary as long as we don't repeat
      flashLoanPremium: {
        total: 0.0005e4, // 0.05%
        protocol: 0.0004e4, // 0.04%
      },
      rateStrategies: [],
      reservesConfig: {},
    },
    odos: {
      router: "", // TODO fill in
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
