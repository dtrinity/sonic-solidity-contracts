import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Config } from "../types";
import { ONE_PERCENT_BPS } from "../constants";

export async function getConfig(
  hre: HardhatRuntimeEnvironment
): Promise<Config> {
  // Replace these with actual contract addresses from Sonic mainnet
  const dUSDAddress = "0x53a6aBb52B2F968fA80dF6A894e4f1b1020DA975"; // Replace with actual dUSD address
  const odosRouterAddress = "0xaC041Df48dF9791B0654f1Dbbf2CC8450C5f2e9D"; // Odos router on Sonic
  
  return {
    liquidatorBotOdos: {
      flashMinter: dUSDAddress, // dUSD is the flash minter
      dUSDAddress: dUSDAddress,
      slippageTolerance: 50 * ONE_PERCENT_BPS, // 50%
      healthFactorThreshold: 1,
      healthFactorBatchSize: 5,
      reserveBatchSize: 5, 
      profitableThresholdInUSD: 0.001,
      liquidatingBatchSize: 200,
      graphConfig: {
        url: "https://api.thegraph.com/subgraphs/name/dtrinity/dlending-sonic", // Replace with actual subgraph URL
        batchSize: 1000,
      },
      proxyContractMap: {
        // Add proxy contract mappings here
      },
      isUnstakeTokens: {
        // Add unstake token mappings here
      },
      odosRouter: odosRouterAddress,
      odosApiUrl: "https://api.odos.xyz",
    },
  };
} 