import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    console.log("No dPool configuration found, skipping DPoolVaultFactory deployment");
    return;
  }

  console.log(`\n--- Deploying DPoolVaultFactory ---`);

  // Deploy the factory
  const factory = await deploy("DPoolVaultFactory", {
    contract: "DPoolVaultFactory",
    from: deployer,
    args: [
      deployer, // admin - initially deployer, can be changed later
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  if (factory.newlyDeployed) {
    console.log(`✅ Deployed DPoolVaultFactory at: ${factory.address}`);
  } else {
    console.log(`♻️  Reusing existing DPoolVaultFactory at: ${factory.address}`);
  }

  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-factory"];
func.dependencies = [];

export default func; 