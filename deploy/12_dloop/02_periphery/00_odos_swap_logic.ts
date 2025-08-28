import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID } from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, getChainId } = hre;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId();

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

func.tags = ["dloop", "dloop-periphery-swap-logic", "dloop-periphery-swap-logic-odos"];
func.id = DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID;

export default func;
