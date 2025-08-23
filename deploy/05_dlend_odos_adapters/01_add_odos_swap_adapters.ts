import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID, POOL_PROXY_ID } from "../../typescript/deploy-ids";

// List of all Odos adapters to deploy
const ODOS_ADAPTERS = ["OdosLiquiditySwapAdapter", "OdosDebtSwapAdapter", "OdosRepayAdapter", "OdosWithdrawSwapAdapter"] as const;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get deployed addresses
  const { address: providerAddress } = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const { address: poolAddress } = await hre.deployments.get(POOL_PROXY_ID);

  // Get configuration
  const config = await getConfig(hre);
  const odosRouterAddress = config.odos?.router;

  if (!odosRouterAddress) {
    console.log("Skip: Odos router not found in configuration");
    return false;
  }

  // Deploy all adapters
  for (const adapter of ODOS_ADAPTERS) {
    await hre.deployments.deploy(adapter, {
      from: deployer,
      // The owner can only rescue tokens, so no need to transfer to governance
      args: [providerAddress, poolAddress, odosRouterAddress, deployer],
      contract: adapter,
      autoMine: true,
      log: true,
    });
  }

  console.log(`🔀 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

// Set deployment tags and dependencies
func.tags = ["dlend", "dlend-periphery", "dlend-odos-adapters"];
func.dependencies = [POOL_ADDRESSES_PROVIDER_ID, POOL_PROXY_ID, "mock_odos_router_setup"];
func.id = `dLend:OdosAdapters`;

export default func;
