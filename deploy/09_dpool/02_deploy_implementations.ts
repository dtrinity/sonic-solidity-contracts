import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    console.log("No dPool configuration found, skipping dPOOL implementations deployment");
    return;
  }

  console.log(`\n--- Deploying dPOOL Implementations ---`);

  // Get factory deployment
  let factoryDeployment;
  try {
    factoryDeployment = await get("DPoolVaultFactory");
  } catch (error) {
    console.log(`⚠️  Failed to get DPoolVaultFactory deployment: ${error}`);
    console.log(`⚠️  Skipping implementations deployment: factory not found`);
    return;
  }

  // Deploy Curve vault implementation
  const curveVaultImpl = await deploy("DPoolVaultCurveLP_Implementation", {
    contract: "DPoolVaultCurveLP",
    from: deployer,
    args: [
      // These are dummy values since this is just an implementation
      deployer, // baseAsset (dummy)
      deployer, // lpToken (dummy)  
      deployer, // pool (dummy)
      0, // baseAssetIndex (dummy)
      "Implementation", // name (dummy)
      "IMPL", // symbol (dummy)
      deployer, // admin (dummy)
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  if (curveVaultImpl.newlyDeployed) {
    console.log(`✅ Deployed Curve Vault Implementation at: ${curveVaultImpl.address}`);
  } else {
    console.log(`♻️  Reusing existing Curve Vault Implementation at: ${curveVaultImpl.address}`);
  }

  // Deploy Curve periphery implementation
  const curvePeripheryImpl = await deploy("DPoolCurvePeriphery_Implementation", {
    contract: "DPoolCurvePeriphery",
    from: deployer,
    args: [
      // These are dummy values since this is just an implementation
      deployer, // vault (dummy)
      deployer, // pool (dummy)
      deployer, // admin (dummy)
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  if (curvePeripheryImpl.newlyDeployed) {
    console.log(`✅ Deployed Curve Periphery Implementation at: ${curvePeripheryImpl.address}`);
  } else {
    console.log(`♻️  Reusing existing Curve Periphery Implementation at: ${curvePeripheryImpl.address}`);
  }

  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-implementations"];
func.dependencies = ["dpool-factory"];

export default func; 