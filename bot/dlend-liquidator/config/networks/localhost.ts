import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Config } from "../types";

export async function getConfig(
  hre: HardhatRuntimeEnvironment
): Promise<Config> {
  return {
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
      proxyContractMap: {},
      isUnstakeTokens: {},
      odosRouter: "0x00000000000000000000000000000000000000F2",
      odosApiUrl: "https://api.odos.xyz",
    },
  };
} 