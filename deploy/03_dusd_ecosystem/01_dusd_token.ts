import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { DUSD_TOKEN_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Deploy dUSD token as an upgradeable contract with proxy
  await hre.deployments.deploy(DUSD_TOKEN_ID, {
    from: deployer,
    contract: "ERC20StablecoinUpgradeable",
    proxy: {
      execute: {
        init: {
          methodName: "initialize",
          args: ["dTRINITY USD", "dUSD"],
        },
      },
      proxyContract: "OpenZeppelinTransparentProxy",
    },
    log: true,
    autoMine: true,
  });

  console.log(`☯️ ${__filename.split("/").slice(-1)[0]}: ✅`);

  return true;
};

func.id = DUSD_TOKEN_ID;
func.tags = ["dusd", "token", "upgradeable"];

export default func;
