import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID } from "../../../typescript/deploy-ids";
import { isLocalNetwork } from "../../../typescript/hardhat/deploy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, getChainId } = hre;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId();

  // Skip for local networks
  if (isLocalNetwork(hre.network.name)) {
    console.log(`Skipping dLOOP Periphery Odos swap logic deployment for network ${hre.network.name}.`);
    return;
  }

  // Get network config
  const networkConfig = await getConfig(hre);
  const dloopConfig = networkConfig.dLoop;

  // Skip if no dLOOP configuration or no Odos configuration is defined
  if (!dloopConfig || (!dloopConfig.depositors?.odos && !dloopConfig.redeemers?.odos)) {
    console.log(`No Odos configuration defined for network ${hre.network.name}. Skipping.`);
    return;
  }

  console.log(`Deploying Odos swap logic on network ${hre.network.name} (chainId: ${chainId})`);

  await hre.deployments.deploy(DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID, {
    from: deployer,
    contract: "OdosSwapLogic",
    args: [],
    log: true,
    autoMine: true,
  });

  console.log("Odos swap logic deployed successfully");

  return true;
};

func.tags = ["dloop", "periphery", "odos", "swap-logic"];
func.id = DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID;

export default func;
