import path from "path";

import { Config } from "../types";

/**
 * Get the config for the localhost network
 *
 * @returns The config for the localhost network
 */
export async function getConfig(): Promise<Config> {
  return {
    parentDeploymentPaths: {
      poolAddressesProvider: path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "deployments",
        "localhost",
        "PoolAddressesProvider.json",
      ),
      poolDataProvider: path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "deployments",
        "localhost",
        "PoolDataProvider.json",
      ),
      aaveOracle: path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "deployments",
        "localhost",
        "PriceOracle.json",
      ),
    },
    tokenProxyContractMap: {}, // No proxy contract on localhost
    liquidatorBotOdos: {
      flashMinter: "0x00000000000000000000000000000000000000F1",
      dUSDAddress: "0x00000000000000000000000000000000000000E3",
      slippageTolerance: 100, // 1% (in basis points)
      healthFactorThreshold: 100000000000000000, // 0.1 in Wei
      healthFactorBatchSize: 10,
      reserveBatchSize: 5,
      profitableThresholdInUSD: 1, // $1
      liquidatingBatchSize: 2,
      graphConfig: {
        url: "http://localhost:8000/subgraphs/name/dtrinity/dlending",
        batchSize: 1000,
      },
      isUnstakeTokens: {},
      odosRouter: "0x00000000000000000000000000000000000000F2",
      odosApiUrl: "https://api.odos.xyz",
    },
  };
}
