import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { DLOOP_PERIPHERY_ODOS_INCREASE_LEVERAGE_ID, DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID } from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, getChainId } = hre;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId();

  // Get network config
  const networkConfig = await getConfig(hre);
  const dloopConfig = networkConfig.dLoop;

  // Skip if no dLOOP configuration or no Odos increase leverage configuration is defined
  if (!dloopConfig || !dloopConfig.increaseLeverage?.odos) {
    console.log(`No Odos increase leverage configuration defined for network ${hre.network.name}. Skipping.`);
    return;
  }

  const odosConfig = dloopConfig.increaseLeverage.odos;

  if (!odosConfig.router) {
    throw new Error("Odos router not defined for network.");
  }

  // Get the dUSD token address from the configuration
  const dUSDAddress = dloopConfig.dUSDAddress;

  if (!dUSDAddress) {
    throw new Error("dUSD token address not found in configuration");
  }

  console.log(`Deploying Odos increase leverage on network ${hre.network.name} (chainId: ${chainId})`);

  const { address: odosSwapLogicAddress } = await hre.deployments.get(DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID);

  await hre.deployments.deploy(DLOOP_PERIPHERY_ODOS_INCREASE_LEVERAGE_ID, {
    from: deployer,
    contract: "DLoopIncreaseLeverageOdos",
    args: [dUSDAddress, odosConfig.router],
    libraries: {
      OdosSwapLogic: odosSwapLogicAddress,
    },
    log: true,
    autoMine: true,
  });

  console.log("Odos increase leverage deployed successfully");

  return true;
};

func.tags = ["dloop", "dloop-periphery", "dloop-periphery-increase-leverage", "dloop-periphery-increase-leverage-odos"];
func.dependencies = ["dloop-periphery-swap-logic-odos"];
func.id = DLOOP_PERIPHERY_ODOS_INCREASE_LEVERAGE_ID;

export default func;
