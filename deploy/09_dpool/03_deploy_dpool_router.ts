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
    console.log("No dPool configuration found, skipping DPoolRouter deployment");
    return;
  }

  // Deploy router for each dPool instance
  for (const [dPoolName] of Object.entries(config.dPool)) {
    console.log(`\n--- Deploying DPoolRouter for ${dPoolName} ---`);

    // Get DPoolToken deployment
    const tokenName = `DPoolToken_${dPoolName}`;

    let poolTokenDeployment;

    try {
      poolTokenDeployment = await get(tokenName);
    } catch (error) {
      console.log(`⚠️  Failed to get DPoolToken deployment ${tokenName}: ${error}`);
      console.log(`⚠️  Skipping ${dPoolName}: DPoolToken not found (${tokenName})`);
      continue;
    }

    // Get collateral vault deployment
    const collateralVaultName = `DPoolCollateralVault_${dPoolName}`;

    let collateralVaultDeployment;

    try {
      collateralVaultDeployment = await get(collateralVaultName);
    } catch (error) {
      console.log(`⚠️  Failed to get DPoolCollateralVault deployment ${collateralVaultName}: ${error}`);
      console.log(
        `⚠️  Skipping ${dPoolName}: DPoolCollateralVault not found (${collateralVaultName})`,
      );
      continue;
    }

    const routerName = `DPoolRouter_${dPoolName}`;

    console.log(`Deploying DPoolRouter: ${routerName}`);
    console.log(`  Pool Token: ${poolTokenDeployment.address}`);
    console.log(`  Collateral Vault: ${collateralVaultDeployment.address}`);

    const router = await deploy(routerName, {
      contract: "DPoolRouter",
      from: deployer,
      args: [
        poolTokenDeployment.address, // Real DPoolToken address
        collateralVaultDeployment.address, // Collateral vault address
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    if (router.newlyDeployed) {
      console.log(`✅ Deployed ${routerName} at: ${router.address}`);
    } else {
      console.log(`♻️  Reusing existing ${routerName} at: ${router.address}`);
    }
  }

  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-router"];
func.dependencies = ["dpool-token", "dpool-collateral-vault"];

export default func;
