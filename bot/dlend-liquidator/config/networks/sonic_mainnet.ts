import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Config } from "../types";

export async function getConfig(
  hre: HardhatRuntimeEnvironment
): Promise<Config> {
  // Replace these with actual contract addresses from Sonic mainnet
  const dUSDAddress = "0x0000000000000000000000000000000000000000"; // Replace with actual dUSD address
  const odosRouterAddress = "0x4E3288c9ca110bCC82bf38F09A7b425c095d92Bf"; // Odos router on Sonic
  
  return {
    lending: {
      providerID: 1,
      reserveAssetAddresses: {
        // Sample addresses - to be replaced with actual addresses on Sonic
        WETH: "0x0000000000000000000000000000000000000000", // Replace with actual WETH address
        USDC: "0x0000000000000000000000000000000000000000", // Replace with actual USDC address
        dUSD: dUSDAddress,
      },
      flashLoanPremium: {
        total: 9,
        protocol: 0,
      },
    },
    liquidatorBotOdos: {
      flashMinter: "0x0000000000000000000000000000000000000000", // Replace with actual flash minter address
      dUSDAddress: dUSDAddress,
      slippageTolerance: 100, // 1% (in basis points)
      healthFactorThreshold: 100000000000000000, // 0.1 in Wei
      healthFactorBatchSize: 10,
      reserveBatchSize: 5, 
      profitableThresholdInUSD: 1, // $1
      liquidatingBatchSize: 2,
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