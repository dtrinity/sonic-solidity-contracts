import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "../types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(
  _hre: HardhatRuntimeEnvironment
): Promise<Config> {
  const dUSDDeployment = await _hre.deployments.getOrNull("dUSD");
  const dSDeployment = await _hre.deployments.getOrNull("dS");

  return {
    tokenAddresses: {
      dUSD: emptyStringIfUndefined(dUSDDeployment?.address),
      dS: emptyStringIfUndefined(dSDeployment?.address),
      wS: "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38",
    },
    oracleAggregator: {
      hardDusdPeg: 10 ** ORACLE_AGGREGATOR_PRICE_DECIMALS,
      priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
      api3OracleAssets: {
        plainApi3OracleWrappers: {},
        api3OracleWrappersWithThresholding: {},
        compositeApi3OracleWrappersWithThresholding: {},
      },
    },
  };
}

function emptyStringIfUndefined(value: string | undefined): string {
  return value ?? "";
}
