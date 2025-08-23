import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { DLOOP_PERIPHERY_ODOS_REDEEMER_ID, DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID } from "../../../typescript/deploy-ids";
import { isLocalNetwork } from "../../../typescript/hardhat/deploy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, getChainId } = hre;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId();

  // Skip for local networks
  if (isLocalNetwork(hre.network.name)) {
    console.log(`Skipping dLOOP Periphery Odos redeemer deployment for network ${hre.network.name}.`);
    return;
  }

  // Get network config
  const networkConfig = await getConfig(hre);
  const dloopConfig = networkConfig.dLoop;

  // Skip if no dLOOP configuration or no Odos redeemer configuration is defined
  if (!dloopConfig || !dloopConfig.redeemers?.odos) {
    console.log(`No Odos redeemer configuration defined for network ${hre.network.name}. Skipping.`);
    return;
  }

  const odosConfig = dloopConfig.redeemers.odos;

  if (!odosConfig.router) {
    console.log(`Odos router not defined for network ${hre.network.name}. Skipping.`);
    return;
  }

  // Get the dUSD token address from the configuration
  const dUSDAddress = dloopConfig.dUSDAddress;

  if (!dUSDAddress) {
    throw new Error("dUSD token address not found in configuration");
  }

  console.log(`Deploying Odos redeemer on network ${hre.network.name} (chainId: ${chainId})`);

  const { address: odosSwapLogicAddress } = await hre.deployments.get(DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID);

  await hre.deployments.deploy(DLOOP_PERIPHERY_ODOS_REDEEMER_ID, {
    from: deployer,
    contract: "DLoopRedeemerOdos",
    args: [dUSDAddress, odosConfig.router],
    libraries: {
      OdosSwapLogic: odosSwapLogicAddress,
    },
    log: true,
    autoMine: true,
  });

  console.log("Odos redeemer deployed successfully");

  return true;
};

func.tags = ["dloop", "periphery", "odos", "redeemer"];
func.dependencies = [DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID];
func.id = DLOOP_PERIPHERY_ODOS_REDEEMER_ID;

export default func;
