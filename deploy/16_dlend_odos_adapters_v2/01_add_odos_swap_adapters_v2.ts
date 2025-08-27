import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_PROXY_ID,
} from "../../typescript/deploy-ids";

// List of all Odos V2 adapters to deploy (with PT token support)
const ODOS_ADAPTERS_V2 = [
  "OdosLiquiditySwapAdapterV2",
  "OdosRepayAdapterV2",
  "OdosWithdrawSwapAdapterV2",
  "OdosDebtSwapAdapterV2",
] as const;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get deployed addresses
  const { address: providerAddress } = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID,
  );
  const { address: poolAddress } = await hre.deployments.get(POOL_PROXY_ID);

  // Get configuration
  const config = await getConfig(hre);
  const odosRouterAddress = config.odos?.router;
  const pendleRouterAddress = config.odos?.pendleRouter;

  // Only deploy V2 adapters if both Odos and Pendle routers are configured
  if (!odosRouterAddress) {
    console.log("Skip: Odos router not found in configuration");
    return false;
  }

  if (!pendleRouterAddress) {
    console.log("Skip: Pendle router not found in configuration - required for V2 adapters");
    return false;
  }

  console.log(`Deploying Odos V2 adapters with:`);
  console.log(`  Odos Router: ${odosRouterAddress}`);
  console.log(`  Pendle Router: ${pendleRouterAddress}`);

  // Deploy all V2 adapters
  for (const adapter of ODOS_ADAPTERS_V2) {
    await hre.deployments.deploy(adapter, {
      from: deployer,
      // V2 constructors: (addressesProvider, pool, odosRouter, pendleRouter, owner)
      args: [providerAddress, poolAddress, odosRouterAddress, pendleRouterAddress, deployer],
      contract: adapter,
      autoMine: true,
      log: true,
    });
  }

  console.log(`🔀 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

// Set deployment tags and dependencies
func.tags = ["dlend", "dlend-periphery", "dlend-odos-adapters-v2"];
func.dependencies = [
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_PROXY_ID,
  "mock_odos_router_setup",
];
func.id = `dLend:OdosAdaptersV2`;

export default func;