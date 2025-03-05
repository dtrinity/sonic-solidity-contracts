import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "../types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";

export const TOKEN_INFO = {
  // TODO fill out
};

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(
  _hre: HardhatRuntimeEnvironment
): Promise<Config> {
  return {
    dusd: {
      address: "", // TODO
    },
    oracleAggregator: {
      hardDusdPeg: 10 ** ORACLE_AGGREGATOR_PRICE_DECIMALS,
      priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
      dUSDAddress: "", // TODO
      api3OracleAssets: {
        plainApi3OracleWrappers: {},
        api3OracleWrappersWithThresholding: {},
        compositeApi3OracleWrappersWithThresholding: {},
      },
    },
  };
}
