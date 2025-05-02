import { ONE_PERCENT_BPS } from "../constants";
import { Config } from "../types";

/**
 * Get the config for the Sonic mainnet network
 *
 * @returns The config for the Sonic mainnet network
 */
export async function getConfig(): Promise<Config> {
  // Replace these with actual contract addresses from Sonic mainnet
  const dUSDAddress = "0x53a6aBb52B2F968fA80dF6A894e4f1b1020DA975"; // Replace with actual dUSD address
  const odosRouterAddress = "0xaC041Df48dF9791B0654f1Dbbf2CC8450C5f2e9D"; // Odos router on Sonic

  return {
    parentDeploymentAddresses: {
      poolAddressesProvider: "0x1f8d8a3575d049aA0C195AA947483738811bAdcb",
      poolDataProvider: "0xB245F8321E7A4938DEf8bDb2D5E2E16481268c42",
      aaveOracle: "0x4EF3aa6aF9174e01C893aa4cD7F26E23c69B7b83", // PriceOracle
      liquidationLogic: "0x19C6B5924306BAF5ee549Cd7b56b37736Cf7Dc48", // LiquidationLogic
    },
    tokenProxyContractMap: {}, // No proxy contract on Sonic mainnet
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
        url: "http://35.83.220.110/subgraphs/name/stablyio-aave-v3-messari-sonic-mainnet", // TODO: Replace with actual subgraph URL
        batchSize: 1000,
      },
      isUnstakeTokens: {
        // Add unstake token mappings here
      },
      odosRouter: odosRouterAddress,
      odosApiUrl: "https://api.odos.xyz",
    },
  };
}
